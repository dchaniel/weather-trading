# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## Linear (Project Management)

- **API Key**: Stored in `skills.entries.linear.apiKey` in OpenClaw config
- **Workspace**: DanielC (team key: `DAN`)
- **Project**: Weather Trading — https://linear.app/danielc/project/weather-trading-5596cb5b26ca
- **Team ID**: `baa3f38d-1283-4c55-b5f5-a1f632f6702f`
- **Project ID**: `bc7239e8-c969-479d-b09a-46680bdf05b1`

### GTD Workflow
Follow Getting Things Done principles with Linear:
1. **Collect** — Every actionable task goes into Linear. Be specific: "Wire up Kalshi order placement endpoint" not "Do Kalshi stuff."
2. **Organize** — Use priorities (Urgent/High/Medium/Low) and states (Todo/In Progress/Done). Move items as status changes.
3. **Comment always** — Add a comment when:
   - **Starting** a task (what your plan is)
   - **Stuck** on something (what's blocking you)
   - **Finished** (what you did, any follow-ups)
   - This creates a trail future agents can follow without guessing.
4. **Review** — Before starting work, check the project for open items. After finishing, update states and create new issues for anything that emerged.
5. **Break down** — If a task takes more than one session, break it into subtasks.

### Linear API Usage
```bash
# Query issues
curl -s https://api.linear.app/graphql \
  -H "Authorization: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ project(id: \"PROJECT_ID\") { issues { nodes { identifier title state { name } } } } }"}'

# Create issue
curl -s https://api.linear.app/graphql \
  -H "Authorization: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { issueCreate(input: { title: \"...\", teamId: \"TEAM_ID\", projectId: \"PROJECT_ID\", stateId: \"STATE_ID\" }) { success } }"}'

# Add comment
curl -s https://api.linear.app/graphql \
  -H "Authorization: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { commentCreate(input: { issueId: \"ISSUE_ID\", body: \"...\" }) { success } }"}'

# Update issue state
curl -s https://api.linear.app/graphql \
  -H "Authorization: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { issueUpdate(id: \"ISSUE_ID\", input: { stateId: \"STATE_ID\" }) { success } }"}'
```

### State IDs
- Backlog: `ba01d0d4-5258-46bb-a100-41d933f03f2a`
- Todo: `7c8eb953-2440-4764-a016-67f39c45a73e`
- In Progress: `fd2e7255-c34f-4d7a-8668-84d0411249d4`
- In Review: `9ad2197d-4455-4967-a649-eb84ba33c427`
- Waiting: `40e10f11-379d-40cd-b303-ab3e79a5d760`
- Done: `25f8f7c6-7313-4403-8ceb-06039a4c5b0e`
- Canceled: `e69584d3-466f-41ed-9072-566cec963cde`

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
