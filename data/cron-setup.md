# OpenClaw Weather Trading Automation Setup

This document provides the exact commands and configuration needed to automate the weather trading system using systemd timers (preferred) or cron jobs.

## System Requirements

- Linux system with systemd (Ubuntu 20.04+, RHEL 8+, etc.)
- Node.js v18+ installed
- OpenClaw weather trading system installed at `/home/node/.openclaw/workspace/code/weather-trading`
- Proper API keys configured for Kalshi, NWS, Open-Meteo

## Option 1: Systemd Timers (Recommended)

Systemd timers are more reliable than cron and provide better logging/monitoring.

### 1. Create Service Files

```bash
# Create directory for user services
mkdir -p ~/.config/systemd/user

# Create the base service file
cat > ~/.config/systemd/user/weather-trader.service << 'EOF'
[Unit]
Description=Weather Trading Base Service
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/home/node/.openclaw/workspace/code/weather-trading
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/home/node/.nvm/versions/node/v22.22.0/bin
ExecStart=/usr/bin/node bin/wt.js %i
StandardOutput=journal
StandardError=journal
TimeoutSec=300

[Install]
WantedBy=default.target
EOF
```

### 2. Create Timer Files

```bash
# Implied volatility collection (every 4 hours)
cat > ~/.config/systemd/user/weather-trader-iv.timer << 'EOF'
[Unit]
Description=Collect Implied Volatility Data
Requires=weather-trader@collect-iv.service

[Timer]
OnCalendar=*-*-* 00,06,12,18:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

# Daily briefing (8:00 AM UTC)
cat > ~/.config/systemd/user/weather-trader-daily.timer << 'EOF'
[Unit]
Description=Daily Weather Trading Briefing
Requires=weather-trader@daily.service

[Timer]
OnCalendar=*-*-* 08:00:00
Persistent=true
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
EOF

# Weekly calibration (Sundays at 6:00 AM UTC)
cat > ~/.config/systemd/user/weather-trader-calibrate.timer << 'EOF'
[Unit]
Description=Weekly Forecast Calibration
Requires=weather-trader@calibrate.service

[Timer]
OnCalendar=Sun *-*-* 06:00:00
Persistent=true
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
EOF
```

### 3. Enable and Start Timers

```bash
# Reload systemd configuration
systemctl --user daemon-reload

# Enable and start timers
systemctl --user enable --now weather-trader-iv.timer
systemctl --user enable --now weather-trader-daily.timer
systemctl --user enable --now weather-trader-calibrate.timer

# Enable lingering so services run without login
sudo loginctl enable-linger node
```

### 4. Monitor Services

```bash
# Check timer status
systemctl --user list-timers weather-trader-*

# Check service logs
journalctl --user -u weather-trader@daily.service -f

# Check last run status
systemctl --user status weather-trader@collect-iv.service
```

## Option 2: Cron Jobs (Alternative)

If systemd is not available, use cron jobs:

```bash
# Edit crontab
crontab -e

# Add these lines:
# Collect implied volatility every 4 hours
0 */4 * * * cd /home/node/.openclaw/workspace/code/weather-trading && /usr/bin/node bin/wt.js collect-iv >> /var/log/weather-trader-iv.log 2>&1

# Daily briefing at 8 AM UTC
0 8 * * * cd /home/node/.openclaw/workspace/code/weather-trading && /usr/bin/node bin/wt.js daily >> /var/log/weather-trader-daily.log 2>&1

# Weekly calibration on Sundays at 6 AM UTC  
0 6 * * 0 cd /home/node/.openclaw/workspace/code/weather-trading && /usr/bin/node bin/wt.js calibrate >> /var/log/weather-trader-calibrate.log 2>&1
```

## Telegram Integration

For daily briefings with Telegram push notifications:

### 1. Configure Telegram Bot

```bash
# Set up Telegram bot token in OpenClaw config
# This should be configured in your OpenClaw settings
```

### 2. Update Daily Command for Push

Modify the daily command to support `--push` flag:

```bash
# Test Telegram integration
node bin/wt.js daily --push
```

### 3. Update Timer for Telegram

```bash
# Modify the daily timer service to use --push flag
systemctl --user edit weather-trader@daily.service

# Add this override:
[Service]
ExecStart=
ExecStart=/usr/bin/node bin/wt.js daily --push
```

## Monitoring and Alerting

### 1. Service Health Monitoring

```bash
# Create health check script
cat > ~/bin/check-weather-trader.sh << 'EOF'
#!/bin/bash
cd /home/node/.openclaw/workspace/code/weather-trading

# Run health check
if ! /usr/bin/node bin/wt.js health --quiet; then
    echo "Weather trader health check FAILED at $(date)"
    # Send alert to Telegram or email
    /usr/bin/node bin/wt.js daily --alert --message "Health check failed"
    exit 1
fi

echo "Weather trader health check OK at $(date)"
exit 0
EOF

chmod +x ~/bin/check-weather-trader.sh

# Add health check timer (every 30 minutes)
cat > ~/.config/systemd/user/weather-trader-health.timer << 'EOF'
[Unit]
Description=Weather Trading Health Check

[Timer]
OnCalendar=*:0/30
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat > ~/.config/systemd/user/weather-trader-health.service << 'EOF'
[Unit]
Description=Weather Trading Health Check

[Service]
Type=oneshot
ExecStart=/home/node/bin/check-weather-trader.sh
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

systemctl --user enable --now weather-trader-health.timer
```

### 2. Log Rotation

```bash
# Configure logrotate for weather trader logs
sudo cat > /etc/logrotate.d/weather-trader << 'EOF'
/var/log/weather-trader-*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 node node
}
EOF
```

## Testing the Setup

### 1. Verify All Services

```bash
# Test individual commands
cd /home/node/.openclaw/workspace/code/weather-trading

node bin/wt.js collect-iv
node bin/wt.js daily
node bin/wt.js calibrate
node bin/wt.js health
```

### 2. Check Timer Status

```bash
# List all active timers
systemctl --user list-timers

# Check specific timer
systemctl --user status weather-trader-daily.timer

# View timer logs
journalctl --user -u weather-trader-daily.timer -f
```

### 3. Manual Timer Trigger

```bash
# Trigger timer manually for testing
systemctl --user start weather-trader@daily.service

# Check execution logs
journalctl --user -u weather-trader@daily.service --since "10 minutes ago"
```

## Backup and Recovery

### 1. Backup Critical Data

```bash
# Backup ledger and configuration
tar -czf weather-trader-backup-$(date +%Y%m%d).tar.gz \
    lib/core/ledger.json \
    data/iv-history/ \
    data/forecasts/ \
    ~/.config/systemd/user/weather-trader-*
```

### 2. Recovery

```bash
# Restore from backup
tar -xzf weather-trader-backup-YYYYMMDD.tar.gz

# Reload systemd and restart timers
systemctl --user daemon-reload
systemctl --user restart weather-trader-*.timer
```

## Troubleshooting

### Common Issues

1. **Timer not firing**: Check `systemctl --user list-timers` and ensure lingering is enabled
2. **Service fails**: Check logs with `journalctl --user -u SERVICE_NAME`
3. **Permission denied**: Ensure correct file permissions and PATH environment
4. **API failures**: Check network connectivity and API key validity
5. **Node.js not found**: Update PATH in service file to include Node.js installation

### Emergency Shutdown

```bash
# Stop all weather trading timers
systemctl --user stop weather-trader-*.timer

# Disable automatic startup
systemctl --user disable weather-trader-*.timer
```

## Security Considerations

1. **API Keys**: Store in secure location, never commit to version control
2. **File Permissions**: Ensure service files are readable only by owner
3. **Network**: Consider firewall rules for API access
4. **Logging**: Avoid logging sensitive information (API keys, balances)
5. **Updates**: Keep system and dependencies updated

---

**Setup Complete!** The weather trading system will now run automatically according to the configured schedule. Monitor logs and health status regularly to ensure reliable operation.