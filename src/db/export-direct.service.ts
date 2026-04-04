import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

const IDENT_REGEX = /^[a-zA-Z0-9_]+$/;

function parseTabla(input: string): { schema: string; table: string } | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length === 1) {
    const table = parts[0];
    if (!IDENT_REGEX.test(table)) return null;
    return { schema: 'public', table };
  }
  if (parts.length === 2) {
    const [schema, table] = parts;
    if (!IDENT_REGEX.test(schema) || !IDENT_REGEX.test(table)) return null;
    return { schema, table };
  }
  return null;
}

export type ExportDirectResult =
  | { kind: 'json'; status: number; body: unknown }
  | {
      kind: 'file';
      status: number;
      body: string;
      contentType: string;
      filename: string;
    };

/**
 * Lógica equivalente a export-direct/route.ts del front (Next).
 * Auth: el controlador Nest aplica JWT + rol admin (no se verifica token aquí).
 */
@Injectable()
export class ExportDirectService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null;

  onModuleInit() {
    const url = process.env.DATABASE_URL;
    if (url) {
      this.pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  async handleGet(query: Record<string, string | undefined>): Promise<ExportDirectResult> {
    if (!this.pool) {
      return {
        kind: 'json',
        status: 503,
        body: { error: 'DATABASE_URL no configurada' },
      };
    }

    const pool = this.pool;
    const tablaRaw = query.tabla ?? '';
    const formato = query.formato ?? 'json';
    const meta = query.meta;
    const columnasParam = query.columnas;
    const fechaDesde = query.fechaDesde ?? '';
    const fechaHasta = query.fechaHasta ?? '';
    const soloActivos = query.soloActivos === 'true';
    const explainColumna = query.columna ?? '';
    const explainValor = query.valor ?? '';

    try {
      if (meta === 'db_summary') {
        const sizeResult = await pool.query<{
          bytes: string;
          version: string;
          uptime_seconds: string;
          in_recovery: boolean;
        }>(
          `SELECT pg_database_size(current_database())::bigint::text AS bytes,
                  version() AS version,
                  EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint::text AS uptime_seconds,
                  pg_is_in_recovery() AS in_recovery`,
        );
        const connResult = await pool.query<{ total: string; activas: string }>(
          `SELECT COUNT(*)::text AS total,
                  COUNT(*) FILTER (WHERE state = 'active')::text AS activas
           FROM pg_stat_activity
           WHERE datname = current_database()`,
        );
        const tablesResult = await pool.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total
           FROM information_schema.tables
           WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
             AND table_type = 'BASE TABLE'`,
        );
        const perfResult = await pool.query<{ cache_hit_ratio: string; tps: string }>(
          `SELECT CASE
                    WHEN (blks_hit + blks_read) = 0 THEN '100'
                    ELSE ROUND((blks_hit::numeric / (blks_hit + blks_read)::numeric) * 100, 2)::text
                  END AS cache_hit_ratio,
                  CASE
                    WHEN EXTRACT(EPOCH FROM (now() - stats_reset)) <= 0 THEN '0'
                    ELSE ROUND(((xact_commit + xact_rollback)::numeric / EXTRACT(EPOCH FROM (now() - stats_reset))::numeric), 4)::text
                  END AS tps
           FROM pg_stat_database
           WHERE datname = current_database()`,
        );
        const bytes = Number(sizeResult.rows[0]?.bytes ?? 0);
        const toMB = bytes / (1024 * 1024);
        const uptimeSeconds = Number(sizeResult.rows[0]?.uptime_seconds ?? 0);
        const inRecovery = Boolean(sizeResult.rows[0]?.in_recovery ?? false);
        const versionRaw = String(sizeResult.rows[0]?.version ?? '');
        const versionMatch = versionRaw.match(/PostgreSQL\s+([0-9]+(?:\.[0-9]+)?)/i);
        const version = versionMatch?.[1] ?? versionRaw;
        return {
          kind: 'json',
          status: 200,
          body: {
            bytes,
            sizeMB: Number(toMB.toFixed(2)),
            totalConexiones: Number(connResult.rows[0]?.total ?? 0),
            conexionesActivas: Number(connResult.rows[0]?.activas ?? 0),
            totalTablas: Number(tablesResult.rows[0]?.total ?? 0),
            version,
            uptimeSeconds,
            estadoBd: inRecovery ? 'Mantenimiento/Recuperacion' : 'Activa',
            cacheHitRatio: Number(perfResult.rows[0]?.cache_hit_ratio ?? 0),
            transaccionesPorSegundo: Number(perfResult.rows[0]?.tps ?? 0),
          },
        };
      }

      if (meta === 'table_size') {
        const rows = await pool.query<{ schemaname: string; tablename: string; size_mb: string }>(
          `SELECT n.nspname AS schemaname,
                  c.relname AS tablename,
                  ROUND((pg_total_relation_size(c.oid)::numeric / 1024 / 1024), 2)::text AS size_mb
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind = 'r'
             AND n.nspname NOT IN ('pg_catalog', 'information_schema')
           ORDER BY pg_total_relation_size(c.oid) DESC
           LIMIT 30`,
        );
        return { kind: 'json', status: 200, body: { rows: rows.rows } };
      }

      if (meta === 'realtime_metrics') {
        const summary = await pool.query<{ qps: string; active_connections: string; avg_response_ms: string }>(
          `WITH db AS (
             SELECT CASE
                      WHEN EXTRACT(EPOCH FROM (now() - stats_reset)) <= 0 THEN 0
                      ELSE ((xact_commit + xact_rollback)::numeric / EXTRACT(EPOCH FROM (now() - stats_reset))::numeric)
                    END AS qps
             FROM pg_stat_database
             WHERE datname = current_database()
           ),
           act AS (
             SELECT COUNT(*) FILTER (WHERE state = 'active')::numeric AS active_connections,
                    COALESCE(AVG(EXTRACT(EPOCH FROM (now() - query_start)) * 1000)
                      FILTER (WHERE state = 'active' AND query_start IS NOT NULL), 0)::numeric AS avg_response_ms
             FROM pg_stat_activity
             WHERE datname = current_database()
           )
           SELECT ROUND(db.qps, 4)::text AS qps,
                  ROUND(act.active_connections, 0)::text AS active_connections,
                  ROUND(act.avg_response_ms, 2)::text AS avg_response_ms
           FROM db, act`,
        );
        let avgResponseMs = Number(summary.rows[0]?.avg_response_ms ?? 0);
        if (avgResponseMs <= 0) {
          const extRes = await pool.query<{ enabled: boolean }>(
            `SELECT to_regclass('public.pg_stat_statements') IS NOT NULL AS enabled`,
          );
          const statsEnabled = Boolean(extRes.rows[0]?.enabled);
          if (statsEnabled) {
            const meanRes = await pool.query<{ mean_ms: string }>(
              `SELECT COALESCE(ROUND(AVG(mean_exec_time)::numeric, 2), 0)::text AS mean_ms
               FROM public.pg_stat_statements`,
            );
            avgResponseMs = Number(meanRes.rows[0]?.mean_ms ?? avgResponseMs);
          }
        }
        return {
          kind: 'json',
          status: 200,
          body: {
            timestamp: new Date().toISOString(),
            qps: Number(summary.rows[0]?.qps ?? 0),
            activeConnections: Number(summary.rows[0]?.active_connections ?? 0),
            avgResponseMs,
          },
        };
      }

      if (meta === 'query_insights') {
        const slowQueriesRes = await pool.query<{
          pid: number;
          usename: string;
          state: string | null;
          duration_ms: string;
          query: string | null;
        }>(
          `SELECT pid,
                  usename,
                  state,
                  ROUND(EXTRACT(EPOCH FROM (now() - query_start)) * 1000, 2)::text AS duration_ms,
                  query
           FROM pg_stat_activity
           WHERE datname = current_database()
             AND state = 'active'
             AND query IS NOT NULL
             AND query <> '<IDLE>'
           ORDER BY (now() - query_start) DESC
           LIMIT 20`,
        );

        const extRes = await pool.query<{ enabled: boolean }>(
          `SELECT to_regclass('public.pg_stat_statements') IS NOT NULL AS enabled`,
        );
        const statsEnabled = Boolean(extRes.rows[0]?.enabled);

        let topCostlyQueries: Array<{
          query: string;
          calls: number;
          total_exec_time_ms: number;
          mean_exec_time_ms: number;
        }> = [];

        if (statsEnabled) {
          const costlyRes = await pool.query<{
            query: string;
            calls: string;
            total_exec_time: string;
            mean_exec_time: string;
          }>(
            `SELECT query,
                    calls::text,
                    total_exec_time::text,
                    mean_exec_time::text
             FROM public.pg_stat_statements
             ORDER BY total_exec_time DESC
             LIMIT 5`,
          );
          topCostlyQueries = costlyRes.rows.map((r) => ({
            query: r.query,
            calls: Number(r.calls ?? 0),
            total_exec_time_ms: Number(r.total_exec_time ?? 0),
            mean_exec_time_ms: Number(r.mean_exec_time ?? 0),
          }));
        }

        return {
          kind: 'json',
          status: 200,
          body: {
            slowQueries: slowQueriesRes.rows.map((r) => ({
              pid: r.pid,
              usename: r.usename,
              state: r.state,
              durationMs: Number(r.duration_ms ?? 0),
              query: r.query,
            })),
            topCostlyQueries,
            pgStatStatementsEnabled: statsEnabled,
          },
        };
      }

      if (meta === 'table_stats') {
        const stats = await pool.query<{
          schemaname: string;
          relname: string;
          seq_scan: string;
          idx_scan: string;
          n_live_tup: string;
          n_dead_tup: string;
          n_tup_ins: string;
          n_tup_upd: string;
          n_tup_del: string;
          last_vacuum: string | null;
          last_autovacuum: string | null;
        }>(
          `SELECT schemaname,
                  relname,
                  seq_scan::text,
                  idx_scan::text,
                  n_live_tup::text,
                  n_dead_tup::text,
                  n_tup_ins::text,
                  n_tup_upd::text,
                  n_tup_del::text,
                  last_vacuum::text,
                  last_autovacuum::text
           FROM pg_stat_user_tables
           ORDER BY n_dead_tup DESC, n_live_tup DESC
           LIMIT 100`,
        );
        return { kind: 'json', status: 200, body: { rows: stats.rows } };
      }

      if (meta === 'index_stats') {
        const stats = await pool.query<{
          schemaname: string;
          tablename: string;
          indexname: string;
          idx_scan: string;
          seq_scan: string;
          eficiencia: string;
        }>(
          `SELECT i.schemaname,
                  i.relname AS tablename,
                  i.indexrelname AS indexname,
                  i.idx_scan::text,
                  t.seq_scan::text,
                  CASE
                    WHEN (i.idx_scan + t.seq_scan) = 0 THEN '0'
                    ELSE ROUND((i.idx_scan::numeric / (i.idx_scan + t.seq_scan)::numeric) * 100, 2)::text
                  END AS eficiencia
           FROM pg_stat_user_indexes i
           JOIN pg_stat_user_tables t
             ON t.schemaname = i.schemaname
            AND t.relname = i.relname
           ORDER BY (i.idx_scan + t.seq_scan) DESC, i.indexrelname
           LIMIT 200`,
        );
        return { kind: 'json', status: 200, body: { rows: stats.rows } };
      }

      if (meta === 'activity') {
        const activity = await pool.query<{
          pid: number;
          usename: string;
          datname: string;
          state: string | null;
          wait_event_type: string | null;
          wait_event: string | null;
          query_start: string | null;
          query: string | null;
        }>(
          `SELECT pid,
                  usename,
                  datname,
                  state,
                  wait_event_type,
                  wait_event,
                  query_start::text,
                  query
           FROM pg_stat_activity
           WHERE datname = current_database()
           ORDER BY query_start DESC
           LIMIT 50`,
        );
        return { kind: 'json', status: 200, body: { rows: activity.rows } };
      }

      if (meta === 'locks') {
        const locks = await pool.query<{
          pid: number;
          locktype: string;
          mode: string;
          granted: boolean;
          relation: string | null;
          state: string | null;
          wait_event_type: string | null;
          wait_event: string | null;
          query: string | null;
        }>(
          `SELECT l.pid,
                  l.locktype,
                  l.mode,
                  l.granted,
                  COALESCE(c.relname, l.relation::regclass::text) AS relation,
                  a.state,
                  a.wait_event_type,
                  a.wait_event,
                  a.query
           FROM pg_locks l
           LEFT JOIN pg_stat_activity a ON a.pid = l.pid
           LEFT JOIN pg_class c ON c.oid = l.relation
           WHERE a.datname = current_database()
           ORDER BY l.granted ASC, l.pid ASC
           LIMIT 100`,
        );
        return { kind: 'json', status: 200, body: { rows: locks.rows } };
      }

      if (!tablaRaw) {
        const listResult = await pool.query<{ table_schema: string; table_name: string }>(
          `SELECT table_schema, table_name
           FROM information_schema.tables
           WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
             AND table_type = 'BASE TABLE'
           ORDER BY table_schema, table_name`,
        );
        const tablas = listResult.rows.map((r) =>
          r.table_schema === 'public' ? r.table_name : `${r.table_schema}.${r.table_name}`,
        );
        return { kind: 'json', status: 200, body: { tablas } };
      }

      const parsed = parseTabla(tablaRaw);
      if (!parsed) {
        return { kind: 'json', status: 400, body: { error: 'Nombre de tabla no válido' } };
      }
      const tabla = parsed.table;
      const schema = parsed.schema;

      if (meta === '1') {
        const colResult = await pool.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns 
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [schema, tabla],
        );
        const columnas = colResult.rows.map((r) => r.column_name);
        return { kind: 'json', status: 200, body: { columnas } };
      }

      if (meta === 'schema') {
        const colResult = await pool.query<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          character_maximum_length: number | null;
          numeric_precision: number | null;
          numeric_scale: number | null;
          column_default: string | null;
          is_identity: string;
          is_generated: string;
        }>(
          `SELECT column_name,
                  data_type,
                  is_nullable,
                  character_maximum_length,
                  numeric_precision,
                  numeric_scale,
                  column_default,
                  is_identity,
                  is_generated
           FROM information_schema.columns 
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [schema, tabla],
        );
        const columnas = colResult.rows.map((r) => ({
          nombre: r.column_name,
          tipo: r.data_type,
          nullable: r.is_nullable === 'YES',
          maxLength: r.character_maximum_length,
          numericPrecision: r.numeric_precision,
          numericScale: r.numeric_scale,
          porDefecto: r.column_default,
          identity:
            r.is_identity === 'YES' || r.is_generated === 'ALWAYS' || r.is_generated === 'BY DEFAULT',
        }));
        return { kind: 'json', status: 200, body: { columnas } };
      }

      if (meta === 'explain') {
        const colResult = await pool.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns 
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [schema, tabla],
        );
        const columnasReales = colResult.rows.map((r) => r.column_name);
        if (!columnasReales.length) {
          return { kind: 'json', status: 404, body: { error: 'Tabla sin columnas o inexistente' } };
        }

        let query = `SELECT * FROM "${schema}"."${tabla}" LIMIT 200`;
        let explainParams: unknown[] = [];
        if (explainColumna && explainValor && columnasReales.includes(explainColumna)) {
          query = `SELECT * FROM "${schema}"."${tabla}" WHERE "${explainColumna}" = $1 LIMIT 200`;
          explainParams = [explainValor];
        }

        const explain = await pool.query<{ 'QUERY PLAN': unknown }>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
          explainParams,
        );
        const plan = explain.rows?.[0]?.['QUERY PLAN'] ?? null;
        return { kind: 'json', status: 200, body: { plan, query } };
      }

      if (formato !== 'json' && formato !== 'csv') {
        return { kind: 'json', status: 400, body: { error: 'formato debe ser json o csv' } };
      }

      const colResult = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, tabla],
      );
      const columnasReales = colResult.rows.map((r) => r.column_name);
      let columnasSelect =
        columnasParam && columnasParam.trim()
          ? columnasParam
              .split(',')
              .map((c) => c.trim())
              .filter((c) => columnasReales.includes(c))
          : columnasReales;
      if (columnasSelect.length === 0) columnasSelect = columnasReales;

      const dateCol = columnasReales.find(
        (c) => c === 'created_at' || c === 'createdAt' || c === 'fecha_creacion' || c === 'fecha_creado',
      );
      const activoCol = columnasReales.find((c) => c === 'activo' || c === 'disponible');
      const estadoCol = columnasReales.find((c) => c === 'estado');

      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;
      if (dateCol && (fechaDesde || fechaHasta)) {
        if (fechaDesde) {
          conditions.push(`"${dateCol}" >= $${paramIndex}`);
          params.push(fechaDesde);
          paramIndex++;
        }
        if (fechaHasta) {
          conditions.push(`"${dateCol}" <= $${paramIndex}`);
          params.push(fechaHasta + 'T23:59:59.999');
          paramIndex++;
        }
      }
      if (soloActivos) {
        if (activoCol) {
          conditions.push(`"${activoCol}" = true`);
        } else if (estadoCol) {
          conditions.push(`"${estadoCol}" = $${paramIndex}`);
          params.push('activo');
          paramIndex++;
        }
      }

      const selectList = columnasSelect.map((c) => `"${c}"`).join(', ');
      const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
      const sqlQuery = `SELECT ${selectList} FROM "${schema}"."${tabla}"${whereClause}`;
      const result = await pool.query(sqlQuery, params);
      const rows = result.rows as Record<string, unknown>[];

      if (formato === 'json') {
        const body = JSON.stringify(rows, null, 0);
        const filename = `${tabla}_${new Date().toISOString().slice(0, 10)}.json`;
        return {
          kind: 'file',
          status: 200,
          body,
          contentType: 'application/json; charset=utf-8',
          filename,
        };
      }

      if (rows.length === 0) {
        const csv = '';
        const filename = `${tabla}_${new Date().toISOString().slice(0, 10)}.csv`;
        return {
          kind: 'file',
          status: 200,
          body: csv,
          contentType: 'text/csv; charset=utf-8',
          filename,
        };
      }

      const keys = Object.keys(rows[0] as object);
      const escape = (v: unknown): string => {
        const s = v == null ? '' : String(v);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const header = keys.map(escape).join(',');
      const lines = rows.map((r) => keys.map((k) => escape((r as Record<string, unknown>)[k])).join(','));
      const csv = [header, ...lines].join('\r\n');
      const filename = `${tabla}_${new Date().toISOString().slice(0, 10)}.csv`;
      return {
        kind: 'file',
        status: 200,
        body: csv,
        contentType: 'text/csv; charset=utf-8',
        filename,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al consultar la base de datos';
      return { kind: 'json', status: 500, body: { error: message } };
    }
  }
}
