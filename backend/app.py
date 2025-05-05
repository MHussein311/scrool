import os
import sqlite3
import random
import json
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, auth
from math import ceil # Needed for calculating total pages

# --- Configuration ---
# Assume script is run from the 'backend' directory
DATABASE = 'database.db'
VIDEO_DIR = 'videos'
METADATA_FILE = 'metadata.json'
SERVICE_ACCOUNT_KEY = 'scrool-60f79-firebase-adminsdk-fbsvc-763a65bfac.json' # Relative to app.py

# --- Firebase Initialization ---
try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
    firebase_admin.initialize_app(cred)
    print("Firebase Admin SDK Initialized successfully.")
except Exception as e:
    print(f"Error initializing Firebase Admin SDK: {e}")
    # Consider exiting or handling this more gracefully depending on requirements
    # For now, we'll print the error and continue, endpoints requiring auth will fail

app = Flask(__name__)
CORS(app) # Allow all origins for simplicity in development

# --- Database Functions ---
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row # Return rows as dictionary-like objects
    return conn

def init_db():
    try:
        db = get_db()
        cursor = db.cursor()
        # Table to store total likes per video
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS video_stats (
                filename TEXT PRIMARY KEY,
                like_count INTEGER DEFAULT 0
            )
        ''')
        # Table to store which user liked which video
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_likes (
                user_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                PRIMARY KEY (user_id, filename)
            )
        ''')
        db.commit()
        print("Database initialized (video_stats and user_likes tables).")
        # Pre-populate stats if needed (optional)
        # populate_initial_stats(cursor)
        # db.commit()
    except sqlite3.Error as e:
        print(f"Database error during initialization: {e}")
    finally:
        if db:
            db.close()

# Helper to ensure video stats row exists
def ensure_video_stat_exists(cursor, filename):
     cursor.execute("INSERT OR IGNORE INTO video_stats (filename, like_count) VALUES (?, 0)", (filename,))

# Gets total like count and user's like status
def get_video_details(filename, user_id=None):
    details = {'filename': filename, 'like_count': 0, 'is_liked_by_user': False}
    try:
        db = get_db()
        cursor = db.cursor()
        # Get total like count
        cursor.execute("SELECT like_count FROM video_stats WHERE filename = ?", (filename,))
        result = cursor.fetchone()
        if result:
            details['like_count'] = result['like_count']

        # Get user specific like status if user_id is provided
        if user_id:
            cursor.execute("SELECT 1 FROM user_likes WHERE user_id = ? AND filename = ?", (user_id, filename))
            user_like = cursor.fetchone()
            if user_like:
                details['is_liked_by_user'] = True
    except sqlite3.Error as e:
        print(f"Database error getting video details for {filename}: {e}")
    finally:
        if db:
            db.close()
    return details

# Updates user like status and total count
def update_like_status(user_id, filename, action):
    if action not in ['like', 'unlike']:
        return None # Invalid action

    new_like_status = False
    try:
        db = get_db()
        cursor = db.cursor()
        ensure_video_stat_exists(cursor, filename) # Make sure row exists in stats

        cursor.execute("SELECT 1 FROM user_likes WHERE user_id = ? AND filename = ?", (user_id, filename))
        already_liked = cursor.fetchone() is not None

        if action == 'like' and not already_liked:
            cursor.execute("INSERT INTO user_likes (user_id, filename) VALUES (?, ?)", (user_id, filename))
            cursor.execute("UPDATE video_stats SET like_count = like_count + 1 WHERE filename = ?", (filename,))
            new_like_status = True
            print(f"User {user_id} liked {filename}")
        elif action == 'unlike' and already_liked:
            cursor.execute("DELETE FROM user_likes WHERE user_id = ? AND filename = ?", (user_id, filename))
            cursor.execute("UPDATE video_stats SET like_count = MAX(0, like_count - 1) WHERE filename = ?", (filename,))
            new_like_status = False
            print(f"User {user_id} unliked {filename}")
        elif action == 'like' and already_liked:
            print(f"User {user_id} already liked {filename}. No change.")
            new_like_status = True # Still liked
        elif action == 'unlike' and not already_liked:
             print(f"User {user_id} hadn't liked {filename}. No change.")
             new_like_status = False # Still not liked

        db.commit()

        # Fetch the latest total count after potential update
        updated_details = get_video_details(filename, user_id)
        updated_details['action_performed'] = (action == 'like' and not already_liked) or (action == 'unlike' and already_liked)
        return updated_details

    except sqlite3.Error as e:
        print(f"Database error updating like status for {user_id}/{filename}: {e}")
        if db: db.rollback() # Rollback on error
        return None
    except Exception as e: # Catch other potential errors
         print(f"Unexpected error during like update: {e}")
         if db: db.rollback()
         return None
    finally:
        if db:
            db.close()


# --- Metadata Loading ---
def load_metadata():
    try:
        with open(METADATA_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: {METADATA_FILE} not found.")
        return {}
    except json.JSONDecodeError:
        print(f"Error: Could not decode JSON from {METADATA_FILE}.")
        return {}

metadata = load_metadata()

# Helper to get user ID from Authorization header
def get_user_id_from_request(request):
    user_id = None
    id_token = None
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        id_token = auth_header.split('Bearer ')[1]
        try:
            decoded_token = auth.verify_id_token(id_token)
            user_id = decoded_token['uid']
            print(f"Authenticated user: {user_id}")
        except Exception as e:
            print(f"Error verifying token: {e}") # Token might be invalid, expired, etc.
            # Optionally raise an exception or return an error response here if auth is strictly required
    return user_id


# --- API Endpoints ---
@app.route('/videos', methods=['GET'])
def get_all_videos():
    # --- Pagination --- 
    DEFAULT_LIMIT = 10 # Number of videos per page
    try:
        page = int(request.args.get('page', 1)) # Default to page 1
        limit = int(request.args.get('limit', DEFAULT_LIMIT)) 
    except ValueError:
        abort(400, description="Invalid page or limit parameter. Must be integers.")
        
    if page < 1:
        page = 1
    if limit < 1:
        limit = DEFAULT_LIMIT
        
    offset = (page - 1) * limit
    print(f"--- DEBUG: /videos requested page={page}, limit={limit}, offset={offset}")

    user_id = get_user_id_from_request(request)
    
    # --- Get total list of valid filenames FIRST --- 
    try: 
        all_video_files = sorted([f for f in os.listdir(VIDEO_DIR) 
                            if os.path.isfile(os.path.join(VIDEO_DIR, f)) and f.lower().endswith('.mp4')])
    except FileNotFoundError:
         abort(500, description="Video directory not found on server.")
    
    total_videos = len(all_video_files)
    total_pages = ceil(total_videos / limit) if limit > 0 else 1
    
    # --- Get the slice for the current page --- 
    videos_for_page = all_video_files[offset : offset + limit]
    
    # --- Process ONLY the videos for the current page --- 
    videos_data = []
    for filename in videos_for_page:
        video_meta = metadata.get(filename, {}) 
        details = get_video_details(filename, user_id) # Still need DB query per item
        videos_data.append({
            'filename': filename,
            'title': video_meta.get('title', 'Unknown Title'),
            'creator': video_meta.get('creator', '@unknown_creator'),
            'like_count': details['like_count'],
            'is_liked_by_user': details['is_liked_by_user']
        })

    # Optional: Shuffle the current page results? 
    # random.shuffle(videos_data) 
    # NO - Shuffling here breaks pagination consistency. Keep sorted or use DB random sort.

    # Return paginated response
    return jsonify({
        'page': page,
        'limit': limit,
        'total_videos': total_videos,
        'total_pages': total_pages,
        'videos': videos_data # The actual video data for the page
    })

@app.route('/videos/<filename>', methods=['GET'])
def get_video_file(filename):
    # Basic security check
    if '..' in filename or filename.startswith('/'):
        abort(400, description="Invalid filename.")
    
    # Explicitly get absolute path for debugging
    abs_video_dir = os.path.abspath(VIDEO_DIR)
    video_path = os.path.join(abs_video_dir, filename)
    print(f"--- DEBUG: Checking for video file at absolute path: {video_path}") # DEBUG PRINT
    
    # Check if the file exists at that path
    if not os.path.isfile(video_path):
        print(f"--- DEBUG: File NOT FOUND at {video_path}") # DEBUG PRINT
        abort(404, description="Video not found.") 
    
    print(f"--- DEBUG: File FOUND at {video_path}. Serving from directory: {abs_video_dir}") # DEBUG PRINT
    # Serve the file from the VIDEO_DIR directory
    return send_from_directory(VIDEO_DIR, filename)

@app.route('/next_video', methods=['POST'])
def get_next_video():
    user_id = get_user_id_from_request(request)
    exclude_list = request.json.get('exclude', [])
    # Filter for .mp4 files specifically (case-insensitive) AND exclude watched ones
    available_files = [f for f in os.listdir(VIDEO_DIR) 
                       if os.path.isfile(os.path.join(VIDEO_DIR, f)) 
                       and f.lower().endswith('.mp4') 
                       and f not in exclude_list]

    if not available_files:
        return jsonify({'filename': None, 'title': None, 'creator': None, 'like_count': 0, 'is_liked_by_user': False}), 200 # Indicate no more videos

    next_filename = random.choice(available_files)
    video_meta = metadata.get(next_filename, {})
    details = get_video_details(next_filename, user_id) # Get count and user like status

    return jsonify({
        'filename': next_filename,
        'title': video_meta.get('title', 'Unknown Title'),
        'creator': video_meta.get('creator', '@unknown_creator'),
        'like_count': details['like_count'],
        'is_liked_by_user': details['is_liked_by_user']
    })

@app.route('/video_details/<filename>', methods=['GET'])
def get_specific_video_details(filename):
    # Basic security check for filename
    if '..' in filename or filename.startswith('/'):
        abort(400, description="Invalid filename.")

    # Check if the video file actually exists (optional but good practice)
    video_path = os.path.join(VIDEO_DIR, filename)
    if not os.path.isfile(video_path):
        # Or maybe just return metadata if file missing but metadata exists?
        # For now, return 404 if file is missing.
        abort(404, description="Video file not found.") 

    # Get user ID for like status
    user_id = get_user_id_from_request(request)
    
    # Get metadata and like details
    video_meta = metadata.get(filename, {}) # Get from loaded metadata
    details = get_video_details(filename, user_id) # Get from DB

    # Construct response similar to /next_video
    return jsonify({
        'filename': filename,
        'title': video_meta.get('title', 'Unknown Title'),
        'creator': video_meta.get('creator', '@unknown_creator'),
        'like_count': details['like_count'],
        'is_liked_by_user': details['is_liked_by_user']
    })

@app.route('/videos/<filename>/like', methods=['POST'])
def like_video(filename):
    # --- Authentication ---
    user_id = get_user_id_from_request(request)
    if not user_id:
        # If auth failed or no token provided, return an error
        # Fetch current public details to include in error response
        current_details = get_video_details(filename)
        return jsonify({
            'message': 'Authentication required.',
            'filename': filename,
            'like_count': current_details['like_count'],
            'is_liked_by_user': False # Can't be liked if not authenticated
        }), 401 # Unauthorized

    # --- Input Validation ---
    data = request.get_json()
    if not data or 'action' not in data:
        abort(400, description="Missing 'action' in request body.")
    action = data['action']
    if action not in ['like', 'unlike']:
         abort(400, description="Invalid action. Must be 'like' or 'unlike'.")

    # Basic security check for filename
    if '..' in filename or filename.startswith('/'):
        abort(400, description="Invalid filename.")
    if not os.path.isfile(os.path.join(VIDEO_DIR, filename)):
        abort(404, description="Video not found.")

    # --- Perform Action ---
    result_details = update_like_status(user_id, filename, action)

    if result_details is None:
        # Fetch current details again on error to return something
        current_details = get_video_details(filename, user_id)
        return jsonify({
            'message': f'Failed to {action} video.',
            'filename': filename,
            'like_count': current_details['like_count'],
            'is_liked_by_user': current_details['is_liked_by_user'] # Return current known status
             }), 500 # Internal Server Error

    return jsonify({
        'message': f'Video {action} successful.' if result_details['action_performed'] else f'Video status unchanged.',
        'filename': filename,
        'like_count': result_details['like_count'],
        'is_liked_by_user': result_details['is_liked_by_user'] # Return the NEW like status for the user
    })


# --- Main Execution ---
if __name__ == '__main__':
    init_db() # Ensure DB is initialized on startup
    # Consider using waitress or gunicorn for production instead of Flask dev server
    app.run(debug=True, port=5000) # Runs on http://localhost:5000 