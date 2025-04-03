# Linear MCP Integration

A Model Context Protocol (MCP) server for integrating with Linear's project management platform. This server provides a standardized interface for interacting with Linear's API, including issue management, team coordination, and user tracking.

## Features

- Create, update, and search Linear issues
- Manage team assignments and workflows
- Track user workloads and assignments
- Add comments and updates to issues
- View organization and team structures
- Rate limiting and request queuing for API stability

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/linear-mcp-integration.git
cd linear-mcp-integration
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Add your Linear API key to the `.env` file:
```
LINEAR_API_KEY=your_linear_api_key_here
```

## Usage

### Development

Run the server in development mode:
```bash
npm run dev
```

### Production

Build and run the server:
```bash
npm run build
npm start
```

## API Documentation

### Tools

#### Create Issue
- **Name**: `linear_create_issue`
- **Description**: Creates a new Linear issue
- **Required Fields**: `title`, `teamId`
- **Optional Fields**: `description`, `priority`, `status`

#### Update Issue
- **Name**: `linear_update_issue`
- **Description**: Updates an existing Linear issue
- **Required Fields**: `id`
- **Optional Fields**: `title`, `description`, `priority`, `status`

#### Search Issues
- **Name**: `linear_search_issues`
- **Description**: Searches for issues using flexible criteria
- **Optional Fields**: `query`, `teamId`, `status`, `assigneeId`, `labels`, `priority`, `estimate`, `includeArchived`, `limit`

#### Get User Issues
- **Name**: `linear_get_user_issues`
- **Description**: Retrieves issues assigned to a specific user
- **Optional Fields**: `userId`, `includeArchived`, `limit`

#### Add Comment
- **Name**: `linear_add_comment`
- **Description**: Adds a comment to an existing issue
- **Required Fields**: `issueId`, `body`
- **Optional Fields**: `createAsUser`, `displayIconUrl`

### Resource Templates

- `linear-issue:///{issueId}` - Single issue details
- `linear-viewer:` - Current user information
- `linear-organization:` - Organization details
- `linear-team:///{teamId}/issues` - Team's issue list
- `linear-user:///{userId}/assigned` - User's assigned issues

## Best Practices

1. **Issue Creation**:
   - Use clear, actionable titles
   - Include detailed descriptions with markdown formatting
   - Set appropriate priority levels
   - Always specify the correct team ID

2. **Searching**:
   - Use specific, targeted queries
   - Apply relevant filters to narrow results
   - Combine multiple filters for precise results

3. **Comments**:
   - Use markdown formatting for better readability
   - Keep content focused and relevant
   - Include action items when appropriate

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details
