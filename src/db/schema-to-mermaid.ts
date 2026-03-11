import * as path from 'path';
import * as fs from 'fs';

interface PrismaField {
  name: string;
  type: string;
  isId: boolean;
  isRelation: boolean;
  isOptional: boolean;
  isArray: boolean;
  relationModel?: string;
}

interface PrismaModel {
  name: string;
  fields: PrismaField[];
}

interface Relation {
  from: string;
  to: string;
  label: string;
  cardinality: '1:1' | '1:n' | 'n:1';
}

/** Parsea schema.prisma y extrae modelos y relaciones */
function parsePrismaSchema(content: string): { models: PrismaModel[]; relations: Relation[] } {
  const models: PrismaModel[] = [];
  const relations: Relation[] = [];
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/gs;
  let m: RegExpExecArray | null;
  while ((m = modelRegex.exec(content)) !== null) {
    const modelName = m[1];
    const body = m[2];
    const fields = parseModelBody(body, modelName, relations);
    models.push({ name: modelName, fields });
  }
  return { models, relations };
}

function parseModelBody(body: string, modelName: string, relations: Relation[]): PrismaField[] {
  const fields: PrismaField[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

    const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?(\??)\s*(.*)$/);
    if (!fieldMatch) continue;

    const [, name, type, array, optional, attrs] = fieldMatch;
    const typeName = type.trim();
    const isOptional = optional === '?';
    const isArray = array === '[]';

    const isRelation = /^[A-Z]/.test(typeName) && !['String', 'Int', 'Boolean', 'DateTime', 'Decimal', 'Json'].includes(typeName);
    const isId = /\b@id\b/.test(attrs);
    const hasRelation = /\b@relation\b/.test(attrs) || isRelation;

    fields.push({
      name,
      type: typeName,
      isId,
      isRelation: hasRelation,
      isOptional,
      isArray,
      relationModel: isRelation ? typeName : undefined,
    });

    // Solo añadir relación desde el lado "uno" (array) para evitar duplicados
    if (isRelation && typeName && isArray) {
      relations.push({ from: modelName, to: typeName, label: name, cardinality: '1:n' });
    }
  }
  return fields;
}

/** Genera string Mermaid erDiagram */
function toMermaidErDiagram(models: PrismaModel[], relations: Relation[]): string {
  const lines: string[] = ['erDiagram'];

  for (const model of models) {
    const fieldLines = model.fields
      .filter((f) => !f.isRelation)
      .slice(0, 12)
      .map((f) => {
        const t = mapPrismaTypeToMermaid(f.type);
        const pk = f.isId ? ' PK' : '';
        return `        ${t} ${f.name}${pk}`;
      });
    if (fieldLines.length > 0) {
      lines.push(`    ${model.name} {`);
      lines.push(...fieldLines);
      lines.push('    }');
    }
  }

  const seen = new Set<string>();
  for (const r of relations) {
    const key = `${r.from}-${r.to}-${r.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const arrow = r.cardinality === '1:n' ? '||--o{' : '||--||';
    lines.push(`    ${r.from} ${arrow} ${r.to} : "${r.label}"`);
  }

  return lines.join('\n');
}

function mapPrismaTypeToMermaid(t: string): string {
  const map: Record<string, string> = {
    String: 'string',
    Int: 'int',
    Boolean: 'boolean',
    DateTime: 'datetime',
    Decimal: 'decimal',
    Json: 'json',
  };
  if (t.endsWith('[]')) return 'string';
  return map[t] ?? 'string';
}

export function generateMermaidFromSchema(schemaPath?: string): string {
  const base = path.resolve(process.cwd(), 'prisma', 'schema.prisma');
  const p = schemaPath ?? base;
  if (!fs.existsSync(p)) {
    throw new Error(`Schema no encontrado: ${p}`);
  }
  const content = fs.readFileSync(p, 'utf-8');
  const { models, relations } = parsePrismaSchema(content);
  return toMermaidErDiagram(models, relations);
}
