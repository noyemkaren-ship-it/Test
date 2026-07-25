function safeIdentifier(value, label = 'identifier') {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

function safeClause(clause) {
  const text = String(clause || '').trim();
  if (!text) throw new Error('WHERE clause is required');
  const dangerous = [/;/, /--/, /\/\*/, /\bUNION\b/i, /\bATTACH\b/i, /\bPRAGMA\b/i, /\bDROP\b/i, /\bALTER\b/i];
  if (dangerous.some(pattern => pattern.test(text))) throw new Error('Unsafe SQL clause');
  return text;
}

export function insert_into(tableName, columns) {
  const table = safeIdentifier(tableName, 'table name');
  const cols = String(columns).split(',').map(c => safeIdentifier(c.trim(), 'column name'));
  if (!cols.length) throw new Error('No columns provided');
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
}

export function select_from_where(tableName, whereClause) {
  const table = safeIdentifier(tableName, 'table name');
  return `SELECT * FROM ${table} WHERE ${safeClause(whereClause)}`;
}

export function insert_where_with_json(tableName, data) {
  const table = safeIdentifier(tableName, 'table name');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected object');
  const entries = Object.entries(data);
  if (!entries.length) throw new Error('Data object is empty');
  const columns = entries.map(([key]) => safeIdentifier(key, 'column name'));
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    values: entries.map(([, value]) => value)
  };
}

export function delete_from_where(tableName, whereClause) {
  const table = safeIdentifier(tableName, 'table name');
  const clause = safeClause(whereClause);
  if (!clause.includes('?')) throw new Error('DELETE requires parameter placeholders');
  return `DELETE FROM ${table} WHERE ${clause}`;
}
