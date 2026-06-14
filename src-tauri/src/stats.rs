use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;

pub struct StatsDb {
    conn: Mutex<Connection>,
    pub session_id: String,
}

#[derive(Serialize)]
pub struct NodeStat {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub select_count: i64,
    pub navigate_count: i64,
    pub pass_through_count: i64,
}

#[derive(Serialize)]
pub struct ToolStat {
    pub tool_name: String,
    pub editor_name: Option<String>,
    pub env: Option<String>,
    pub used_count: i64,
}

impl StatsDb {
    pub fn new(db_path: std::path::PathBuf) -> Result<Self, rusqlite::Error> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS node_stats (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_dir INTEGER NOT NULL DEFAULT 0,
                select_count INTEGER NOT NULL DEFAULT 0,
                navigate_count INTEGER NOT NULL DEFAULT 0,
                pass_through_count INTEGER NOT NULL DEFAULT 0,
                last_accessed TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS tool_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_name TEXT NOT NULL,
                editor_name TEXT,
                env TEXT,
                used_count INTEGER NOT NULL DEFAULT 1,
                last_used TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(tool_name, editor_name, env)
            );
            CREATE TABLE IF NOT EXISTS navigation_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                event_type TEXT NOT NULL,
                tool_name TEXT,
                timestamp TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )?;
        let session_id = format!(
            "{:x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        Ok(StatsDb {
            conn: Mutex::new(conn),
            session_id,
        })
    }

    pub fn record_navigate(&self, path: &str, name: &str, is_dir: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO node_stats (path, name, is_dir, navigate_count, last_accessed)
             VALUES (?1, ?2, ?3, 1, datetime('now'))
             ON CONFLICT(path) DO UPDATE SET
               navigate_count = navigate_count + 1,
               last_accessed = datetime('now')",
            rusqlite::params![path, name, is_dir],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO navigation_log (session_id, path, name, event_type)
             VALUES (?1, ?2, ?3, 'navigate')",
            rusqlite::params![self.session_id, path, name],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn record_pass_through(&self, path: &str, name: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE node_stats
             SET pass_through_count = pass_through_count + 1,
                 last_accessed = datetime('now')
             WHERE path = ?1",
            rusqlite::params![path],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO navigation_log (session_id, path, name, event_type)
             VALUES (?1, ?2, ?3, 'pass_through')",
            rusqlite::params![self.session_id, path, name],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn record_select(&self, path: &str, name: &str, is_dir: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO node_stats (path, name, is_dir, select_count, last_accessed)
             VALUES (?1, ?2, ?3, 1, datetime('now'))
             ON CONFLICT(path) DO UPDATE SET
               select_count = select_count + 1,
               last_accessed = datetime('now')",
            rusqlite::params![path, name, is_dir],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO navigation_log (session_id, path, name, event_type)
             VALUES (?1, ?2, ?3, 'select')",
            rusqlite::params![self.session_id, path, name],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn record_tool(
        &self,
        tool_name: &str,
        editor_name: Option<&str>,
        env: Option<&str>,
        path: &str,
        name: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO tool_usage (tool_name, editor_name, env, used_count, last_used)
             VALUES (?1, ?2, ?3, 1, datetime('now'))
             ON CONFLICT(tool_name, editor_name, env) DO UPDATE SET
               used_count = used_count + 1,
               last_used = datetime('now')",
            rusqlite::params![tool_name, editor_name, env],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO navigation_log (session_id, path, name, event_type, tool_name)
             VALUES (?1, ?2, ?3, 'tool_launch', ?4)",
            rusqlite::params![self.session_id, path, name, tool_name],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_frequent_nodes(&self, limit: i64) -> Result<Vec<NodeStat>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT path, name, is_dir, select_count, navigate_count, pass_through_count
                 FROM node_stats
                 ORDER BY (navigate_count + select_count + pass_through_count) DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![limit], |row| {
                Ok(NodeStat {
                    path: row.get(0)?,
                    name: row.get(1)?,
                    is_dir: row.get::<_, i64>(2)? != 0,
                    select_count: row.get(3)?,
                    navigate_count: row.get(4)?,
                    pass_through_count: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub fn get_frequent_tools(&self, limit: i64) -> Result<Vec<ToolStat>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT tool_name, editor_name, env, used_count
                 FROM tool_usage
                 ORDER BY used_count DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![limit], |row| {
                Ok(ToolStat {
                    tool_name: row.get(0)?,
                    editor_name: row.get(1)?,
                    env: row.get(2)?,
                    used_count: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }
}
