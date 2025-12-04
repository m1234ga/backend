# Database Migration Instructions

## New Columns Added

### 1. `messages` table - `mediaPath` column
- **Purpose**: Stores file paths for audio, images, and videos
- **Type**: TEXT (nullable)
- **Migration File**: `backend/database/migrations/add_media_path_to_messages.sql`

### 2. `messageTemplates` table - `mediaPath` column  
- **Purpose**: Stores file paths for media files associated with templates
- **Type**: TEXT (nullable)
- **Migration File**: `backend/database/migrations/add_media_path_to_message_templates.sql`

## How to Run Migrations

### Option 1: Run migrations manually via psql

```bash
# Connect to your PostgreSQL database
psql -U your_username -d your_database_name

# Run the migrations
\i backend/database/migrations/add_media_path_to_messages.sql
\i backend/database/migrations/add_media_path_to_message_templates.sql
```

### Option 2: Run via Node.js script

You can create a script to run migrations automatically, or run them directly:

```bash
cd backend
psql -U your_username -d your_database_name -f database/migrations/add_media_path_to_messages.sql
psql -U your_username -d your_database_name -f database/migrations/add_media_path_to_message_templates.sql
```

### Option 3: The code will handle it automatically

The backend code includes `ALTER TABLE IF EXISTS` statements that will create the columns if they don't exist, but it's recommended to run the migrations manually for better control.

## What Changed

1. **Messages Table**: 
   - Added `mediaPath` column to store file paths for media messages
   - Updated `upsertMessage` function to populate `mediaPath` based on message type:
     - Images/Stickers: `imgs/{messageId}.webp`
     - Audio: `Audio/{messageId}.ogg`
     - Video: `Video/{messageId}.mp4`

2. **Message Templates Table**:
   - Added `mediaPath` column (kept `imagePath` for backward compatibility)
   - Updated `CreateMessageTemplate` endpoint to save both `imagePath` and `mediaPath`

3. **Models**:
   - Updated `ChatMessage` interface to include optional `mediaPath` field

## Usage Example

After running migrations, the `mediaPath` field will be automatically populated when messages are saved:

```typescript
// Example message with mediaPath
{
  id: "123",
  messageType: "image",
  message: "image123.webp",
  mediaPath: "imgs/image123.webp", // New field
  // ... other fields
}
```



















