-- Repository whitelist and configuration
CREATE TABLE repositories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    daily_attempt_limit INTEGER DEFAULT 3,
    daily_pr_limit INTEGER DEFAULT 2,
    score_threshold INTEGER DEFAULT 70,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner, name)
);

-- Issue tracking with enhanced metadata
CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id INTEGER NOT NULL,
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    labels TEXT, -- JSON array of labels
    issue_url TEXT NOT NULL,
    complexity_score INTEGER,
    classification_metadata TEXT, -- JSON with classification details
    last_attempted_at TIMESTAMP,
    attempt_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', -- pending, attempted, solved, failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repository_id) REFERENCES repositories(id),
    UNIQUE(repository_id, issue_number)
);

-- Detailed attempt history with AI interaction tracking
CREATE TABLE attempt_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    status TEXT NOT NULL, -- success, failure, timeout, cancelled
    error_message TEXT,
    workspace_path TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    ai_cost_usd DECIMAL(10,4) DEFAULT 0.0000,
    classification_score INTEGER,
    solution_summary TEXT,
    test_results TEXT, -- JSON with test execution results
    code_changes_summary TEXT, -- Brief summary of changes made
    FOREIGN KEY (issue_id) REFERENCES issues(id)
);

-- Daily statistics with cost tracking
CREATE TABLE daily_stats (
    date DATE PRIMARY KEY,
    total_attempts INTEGER DEFAULT 0,
    total_prs INTEGER DEFAULT 0,
    total_cost_usd DECIMAL(10,2) DEFAULT 0.00,
    successful_attempts INTEGER DEFAULT 0,
    failed_attempts INTEGER DEFAULT 0,
    avg_completion_time_minutes INTEGER DEFAULT 0
);

-- Per-repository daily tracking
CREATE TABLE repo_daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id INTEGER NOT NULL,
    date DATE NOT NULL,
    attempts INTEGER DEFAULT 0,
    prs INTEGER DEFAULT 0,
    cost_usd DECIMAL(10,2) DEFAULT 0.00,
    FOREIGN KEY (repository_id) REFERENCES repositories(id),
    UNIQUE(repository_id, date)
);

-- Enhanced manual queue with priority and user tracking
CREATE TABLE issue_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL,
    priority INTEGER DEFAULT 0, -- Higher numbers = higher priority
    status TEXT DEFAULT 'pending', -- pending, processing, completed, failed, cancelled
    requested_by TEXT NOT NULL,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    estimated_completion_time INTEGER, -- minutes
    FOREIGN KEY (issue_id) REFERENCES issues(id)
);

-- Activity log for debugging and monitoring
CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    level TEXT NOT NULL, -- info, warning, error, debug
    category TEXT NOT NULL, -- repository_scan, issue_classification, code_generation, etc.
    message TEXT NOT NULL,
    metadata TEXT, -- JSON with additional context
    issue_id INTEGER,
    repository_id INTEGER,
    FOREIGN KEY (issue_id) REFERENCES issues(id),
    FOREIGN KEY (repository_id) REFERENCES repositories(id)
);

-- User settings and preferences
CREATE TABLE user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_issues_repository_status ON issues(repository_id, status);
CREATE INDEX idx_issues_last_attempted ON issues(last_attempted_at);
CREATE INDEX idx_attempt_history_issue_status ON attempt_history(issue_id, status);
CREATE INDEX idx_queue_status_priority ON issue_queue(status, priority DESC);
CREATE INDEX idx_activity_log_timestamp ON activity_log(timestamp DESC);
CREATE INDEX idx_activity_log_category ON activity_log(category);