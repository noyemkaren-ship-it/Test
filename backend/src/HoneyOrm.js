/**
 * ARCHIVED PROTOTYPE - NOT USED BY THE V3 RUNTIME.
 *
 * This file is intentionally retained because HoneyORM/PostgreSQL was part of the
 * original project concept. The production v3 runtime uses better-sqlite3. Treat
 * this prototype as design/reference material until a tested adapter replaces the
 * SQLite repository layer.
 */

/*const { Pool } = require('pg');

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m'
};

function logError(message, details = '') {
    console.error(`${colors.red}${colors.bold}❌ ERROR:${colors.reset} ${colors.red}${message}${colors.reset}`);
    if (details) {
        console.error(`${colors.red}   └─ ${details}${colors.reset}`);
    }
}

function logSuccess(message) {
    console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

function logWarning(message) {
    console.log(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

function logInfo(message) {
    console.log(`${colors.cyan}ℹ️  ${message}${colors.reset}`);
}

function id_auto() { return "id SERIAL PRIMARY KEY,\n"; }

function connect(config = {}) {
    try {
        const pool = new Pool({
            host: config.host || 'localhost',
            port: config.port || 5432,
            database: config.database || 'postgres',
            user: config.user || 'postgres',
            password: config.password || '',
            max: config.max || 10,
            ...config
        });

        // Проверяем соединение сразу
        pool.connect()
            .then(client => {
                logSuccess(`Database connected to ${config.database || 'postgres'} on ${config.host || 'localhost'}:${config.port || 5432}`);
                client.release();
            })
            .catch(err => {
                logError('Database connection failed', err.message);
                logInfo(`Connection string: postgresql://${config.user || 'postgres'}@${config.host || 'localhost'}:${config.port || 5432}/${config.database || 'postgres'}`);
            });

        return pool;
    } catch (e) {
        logError('Failed to create connection pool', e.message);
        throw new Error(`Pool creation failed: ${e.message}`);
    }
}

function can_is_null(yes_or_no) {
    if (yes_or_no === true || yes_or_no === "y" || yes_or_no === "yes") {
        return "NOT NULL";
    } else if (yes_or_no === false || yes_or_no === "n" || yes_or_no === "no") {
        return "";
    } else {
        logError(
            `Invalid argument in can_is_null()`,
            `Expected: true/false, "y"/"n", "yes"/"no"\n` +
            `   Received: "${yes_or_no}" (type: ${typeof yes_or_no})`
        );
        throw new Error(`can_is_null: invalid argument "${yes_or_no}". Valid values: y/n/yes/no/true/false`);
    }
}

async function create_table(pool, table_name, model) {
    try {
        if (!table_name || typeof table_name !== 'string') {
            throw new Error(`Invalid table name: "${table_name}". Table name must be a non-empty string.`);
        }
        if (!model || typeof model !== 'string') {
            throw new Error(`Invalid model definition for table "${table_name}". Model must be a non-empty string.`);
        }

        await pool.query(`CREATE TABLE IF NOT EXISTS ${table_name} (${model})`);
        logSuccess(`Table "${table_name}" created successfully`);
        logInfo(`Model: ${model.substring(0, 100)}${model.length > 100 ? '...' : ''}`);
    } catch (e) {
        logError(
            `Failed to create table "${table_name}"`,
            e.message
        );
        if (e.code === '42P07') {
            logWarning(`Table "${table_name}" already exists. Use IF NOT EXISTS to suppress this error.`);
        }
        throw e;
    }
}

async function drop_table(pool, table_name) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }

        await pool.query(`DROP TABLE IF EXISTS ${table_name}`);
        logSuccess(`Table "${table_name}" dropped successfully`);
    } catch (e) {
        logError(
            `Failed to drop table "${table_name}"`,
            e.message
        );
        throw new Error(`Drop table failed: ${e.message}`);
    }
}

async function get_all(pool, table_name) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }

        const result = await pool.query(`SELECT * FROM ${table_name}`);
        logInfo(`Retrieved ${result.rows.length} rows from "${table_name}"`);
        return result.rows;
    } catch (e) {
        logError(
            `Failed to get all records from "${table_name}"`,
            e.message
        );
        if (e.code === '42P01') {
            logWarning(`Table "${table_name}" does not exist. Create it first with create_table().`);
        }
        throw new Error(`Select all failed for table "${table_name}": ${e.message}`);
    }
}

async function get_by_id(pool, table_name, id) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }
        if (!id && id !== 0) {
            throw new Error(`ID is required. Received: ${id}`);
        }

        const result = await pool.query(`SELECT * FROM ${table_name} WHERE id = $1`, [id]);
        
        if (result.rows.length === 0) {
            logWarning(`No record found in "${table_name}" with id = ${id}`);
            return null;
        }
        
        logInfo(`Found record in "${table_name}" with id = ${id}`);
        return result.rows[0];
    } catch (e) {
        logError(
            `Failed to get record by id from "${table_name}"`,
            `ID: ${id}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Select by id failed: ${e.message}`);
    }
}

async function where(pool, table_name, conditions = {}) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }

        const keys = Object.keys(conditions);
        if (keys.length === 0) {
            logInfo(`No conditions provided, fetching all records from "${table_name}"`);
            return get_all(pool, table_name);
        }
        
        const clause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
        const values = keys.map(k => conditions[k]);
        
        const result = await pool.query(`SELECT * FROM ${table_name} WHERE ${clause}`, values);
        logInfo(`Found ${result.rows.length} records in "${table_name}" matching conditions`);
        return result.rows;
    } catch (e) {
        logError(
            `Failed to query "${table_name}" with conditions`,
            `Conditions: ${JSON.stringify(conditions)}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Where query failed: ${e.message}`);
    }
}

async function where_raw(pool, table_name, sql_condition) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }
        if (!sql_condition) {
            throw new Error('SQL condition is required for where_raw()');
        }

        const result = await pool.query(`SELECT * FROM ${table_name} WHERE ${sql_condition}`);
        logInfo(`Found ${result.rows.length} records in "${table_name}" using raw condition`);
        return result.rows;
    } catch (e) {
        logError(
            `Failed to execute raw where query on "${table_name}"`,
            `Condition: ${sql_condition}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Raw where query failed: ${e.message}`);
    }
}

async function insert(pool, table_name, obj) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }
        if (!obj || typeof obj !== 'object' || Object.keys(obj).length === 0) {
            throw new Error(`Insert data is required and must be a non-empty object. Received: ${JSON.stringify(obj)}`);
        }

        const keys = Object.keys(obj);
        const fields = keys.join(', ');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const values = keys.map(k => obj[k]);
        
        const result = await pool.query(
            `INSERT INTO ${table_name} (${fields}) VALUES (${placeholders}) RETURNING *`,
            values
        );
        
        logSuccess(`Inserted into "${table_name}" — id: ${result.rows[0].id}`);
        return result.rows[0];
    } catch (e) {
        logError(
            `Failed to insert into "${table_name}"`,
            `Data: ${JSON.stringify(obj)}\n` +
            `   Error: ${e.message}`
        );
        
        if (e.code === '23505') {
            logWarning('Unique constraint violation. The record already exists.');
        } else if (e.code === '23503') {
            logWarning('Foreign key violation. Referenced record does not exist.');
        } else if (e.code === '23502') {
            logWarning('NOT NULL violation. A required field is missing.');
        }
        
        throw new Error(`Insert failed: ${e.message}`);
    }
}

async function insert_raw(pool, table_name, fields, values) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }
        if (!fields) {
            throw new Error('Fields string is required for raw insert');
        }
        if (!values) {
            throw new Error('Values string is required for raw insert');
        }

        const result = await pool.query(`INSERT INTO ${table_name} (${fields}) VALUES (${values}) RETURNING *`);
        logSuccess(`Raw insert into "${table_name}" successful`);
        return result.rows[0];
    } catch (e) {
        logError(
            `Failed to raw insert into "${table_name}"`,
            `Fields: ${fields}\n` +
            `   Values: ${values}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Raw insert failed: ${e.message}`);
    }
}

async function update(pool, table_name, id, obj) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }
        if (!id && id !== 0) {
            throw new Error(`ID is required for update. Received: ${id}`);
        }
        if (!obj || typeof obj !== 'object' || Object.keys(obj).length === 0) {
            throw new Error(`Update data is required and must be a non-empty object. Received: ${JSON.stringify(obj)}`);
        }

        const keys = Object.keys(obj);
        const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        const values = keys.map(k => obj[k]);
        
        const result = await pool.query(
            `UPDATE ${table_name} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`,
            [...values, id]
        );
        
        if (result.rows.length === 0) {
            logWarning(`No record found in "${table_name}" with id = ${id} to update`);
            return null;
        }
        
        logSuccess(`Updated record in "${table_name}" — id: ${id}`);
        return result.rows[0];
    } catch (e) {
        logError(
            `Failed to update record in "${table_name}"`,
            `ID: ${id}\n` +
            `   Data: ${JSON.stringify(obj)}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Update failed: ${e.message}`);
    }
}

async function update_where(pool, table_name, conditions, obj) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }
        if (!conditions || Object.keys(conditions).length === 0) {
            throw new Error('Conditions are required for update_where()');
        }
        if (!obj || Object.keys(obj).length === 0) {
            throw new Error('Update data is required');
        }

        const setKeys = Object.keys(obj);
        const whereKeys = Object.keys(conditions);
        
        let paramIndex = 1;
        const sets = setKeys.map(k => `${k} = $${paramIndex++}`).join(', ');
        const whereClause = whereKeys.map(k => `${k} = $${paramIndex++}`).join(' AND ');
        
        const values = [...setKeys.map(k => obj[k]), ...whereKeys.map(k => conditions[k])];
        
        const result = await pool.query(
            `UPDATE ${table_name} SET ${sets} WHERE ${whereClause} RETURNING *`,
            values
        );
        
        if (result.rows.length === 0) {
            logWarning(`No records found in "${table_name}" matching conditions to update`);
            return null;
        }
        
        logSuccess(`Updated ${result.rows.length} record(s) in "${table_name}"`);
        return result.rows[0];
    } catch (e) {
        logError(
            `Failed to update records in "${table_name}"`,
            `Conditions: ${JSON.stringify(conditions)}\n` +
            `   Data: ${JSON.stringify(obj)}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Update where failed: ${e.message}`);
    }
}

async function delete_by_id(pool, table_name, id) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }
        if (!id && id !== 0) {
            throw new Error(`ID is required for delete. Received: ${id}`);
        }

        const result = await pool.query(
            `DELETE FROM ${table_name} WHERE id = $1 RETURNING *`,
            [id]
        );
        
        if (result.rows.length === 0) {
            logWarning(`No record found in "${table_name}" with id = ${id} to delete`);
            return null;
        }
        
        logSuccess(`Deleted record from "${table_name}" — id: ${id}`);
        return result.rows[0];
    } catch (e) {
        logError(
            `Failed to delete record from "${table_name}"`,
            `ID: ${id}\n` +
            `   Error: ${e.message}`
        );
        
        if (e.code === '23503') {
            logWarning('Cannot delete: this record is referenced by other records (foreign key constraint).');
        }
        
        throw new Error(`Delete failed: ${e.message}`);
    }
}

async function delete_where(pool, table_name, conditions = {}) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }

        const keys = Object.keys(conditions);
        if (keys.length === 0) {
            throw new Error('Conditions are required for delete_where(). Use delete_all() or provide conditions to avoid accidental mass deletion.');
        }

        const clause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
        const values = keys.map(k => conditions[k]);
        
        const result = await pool.query(
            `DELETE FROM ${table_name} WHERE ${clause} RETURNING *`,
            values
        );
        
        if (result.rows.length === 0) {
            logWarning(`No records found in "${table_name}" matching conditions to delete`);
            return [];
        }
        
        logSuccess(`Deleted ${result.rows.length} record(s) from "${table_name}"`);
        return result.rows;
    } catch (e) {
        logError(
            `Failed to delete records from "${table_name}"`,
            `Conditions: ${JSON.stringify(conditions)}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Delete where failed: ${e.message}`);
    }
}

async function delete_where_raw(pool, table_name, sql_condition) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }
        if (!sql_condition) {
            throw new Error('SQL condition is required for delete_where_raw()');
        }

        const result = await pool.query(`DELETE FROM ${table_name} WHERE ${sql_condition} RETURNING *`);
        
        if (result.rows.length === 0) {
            logWarning(`No records found in "${table_name}" matching raw condition to delete`);
            return [];
        }
        
        logSuccess(`Deleted ${result.rows.length} record(s) from "${table_name}" using raw condition`);
        return result.rows;
    } catch (e) {
        logError(
            `Failed to raw delete from "${table_name}"`,
            `Condition: ${sql_condition}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Raw delete failed: ${e.message}`);
    }
}

async function count(pool, table_name, conditions = {}) {
    try {
        if (!table_name) {
            throw new Error('Table name is required');
        }

        const keys = Object.keys(conditions);
        let result;
        
        if (keys.length === 0) {
            result = await pool.query(`SELECT COUNT(*) as count FROM ${table_name}`);
            logInfo(`Counted all records in "${table_name}"`);
        } else {
            const clause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
            const values = keys.map(k => conditions[k]);
            result = await pool.query(
                `SELECT COUNT(*) as count FROM ${table_name} WHERE ${clause}`,
                values
            );
            logInfo(`Counted records in "${table_name}" matching conditions`);
        }
        
        const count = parseInt(result.rows[0].count);
        return count;
    } catch (e) {
        logError(
            `Failed to count records in "${table_name}"`,
            `Conditions: ${JSON.stringify(conditions)}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Count failed: ${e.message}`);
    }
}

async function raw(pool, sql, params = []) {
    try {
        if (!sql) {
            throw new Error('SQL query is required');
        }

        const result = await pool.query(sql, params);
        logInfo(`Raw query returned ${result.rows.length} rows`);
        return result.rows;
    } catch (e) {
        logError(
            `Failed to execute raw query`,
            `SQL: ${sql.substring(0, 200)}${sql.length > 200 ? '...' : ''}\n` +
            `   Params: ${JSON.stringify(params)}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Raw query failed: ${e.message}`);
    }
}

async function raw_run(pool, sql, params = []) {
    try {
        if (!sql) {
            throw new Error('SQL query is required');
        }

        const result = await pool.query(sql, params);
        logSuccess(`Raw command executed. Rows affected: ${result.rowCount}`);
        return result;
    } catch (e) {
        logError(
            `Failed to execute raw command`,
            `SQL: ${sql.substring(0, 200)}${sql.length > 200 ? '...' : ''}\n` +
            `   Params: ${JSON.stringify(params)}\n` +
            `   Error: ${e.message}`
        );
        throw new Error(`Raw command failed: ${e.message}`);
    }
}

async function transaction(pool, callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        logInfo('Transaction started');
        const result = await callback(client);
        await client.query('COMMIT');
        logSuccess('Transaction committed');
        return result;
    } catch (e) {
        await client.query('ROLLBACK');
        logError(
            `Transaction rolled back`,
            e.message
        );
        throw e;
    } finally {
        client.release();
        logInfo('Client released back to pool');
    }
}

module.exports = {
    connect,
    id_auto,
    create_table,
    drop_table,
    get_all,
    get_by_id,
    where,
    where_raw,
    insert,
    insert_raw,
    update,
    update_where,
    delete_by_id,
    delete_where,
    delete_where_raw,
    count,
    raw,
    raw_run,
    transaction
};*/