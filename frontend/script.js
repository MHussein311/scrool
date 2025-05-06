document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded - Initializing Shorts Clone");

    // --- Firebase Configuration ---
    const firebaseConfig = {
      apiKey: "AIzaSyAO256ZBnoHo5rxFCgArNS8-Dho544ACCw",
      authDomain: "scrool-60f79.firebaseapp.com",
      projectId: "scrool-60f79",
      storageBucket: "scrool-60f79.appspot.com",
      messagingSenderId: "1064710272095",
      appId: "1:1064710272095:web:0da7594c3ac60fd57c97ea",
      measurementId: "G-ZJ84GQX5NL"
    };

    // --- Initialize Firebase ---
    try {
        firebase.initializeApp(firebaseConfig);
        console.log("Firebase App Initialized");
    } catch (e) {
        console.error("Error initializing Firebase App:", e);
        // Handle initialization error (e.g., show message to user)
        return; // Stop execution if Firebase fails to init
    }
    const auth = firebase.auth();
    const googleProvider = new firebase.auth.GoogleAuthProvider();

    // --- DOM References ---
    const appContainer = document.querySelector('.app-container');
    // const initialSlide = document.querySelector('.video-slide'); // REMOVE: No longer needed, was based on static HTML
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const userInfoDiv = document.getElementById('user-info');
    const userEmailSpan = document.getElementById('user-email');
    // Remove unused NodeLists - we query inside slides as needed
    // const slides = document.querySelectorAll('.video-slide'); 
    // const players = document.querySelectorAll('.video-player');
    // const muteButtons = document.querySelectorAll('.mute-button');
    // const scrubBars = document.querySelectorAll('.scrub-bar');
    const userPfpElement = document.getElementById('user-pfp'); // <<< NEW
    const authDropdown = document.getElementById('auth-dropdown'); // <<< NEW
    const dropdownLogoutButton = document.getElementById('dropdown-logout'); // <<< NEW

    // --- State Variables ---
    const API_BASE_URL = 'http://localhost:5000';
    // let currentVideoFilenames = Array(players.length).fill(null); // Not needed like this
    let activeSlideIndex = -1; 
    let userMutedPreference = true; 
    let availableVideos = []; 
    let isInitialized = false;
    let initialMuteOverridden = false; 
    let loadedVideoFilenames = []; 
    let videoStats = {}; // { filename: { like_count: 0, is_liked_by_user: false } } 
    let isFetching = false; 
    let allVideosLoaded = false; 
    let observer; 
    let hasAttemptedInitialNextLoad = false; 
    let currentUser = null; // Store current user object
    let currentIdToken = null; // Store current user's ID token
    let currentPage = 1;
    let totalPages = 1;
    const SLIDE_POOL_SIZE = 5; // <<< NEW: Number of DOM elements to recycle
    let slidePool = []; // <<< NEW: Array to hold the recyclable slide elements
    let virtualScrollPosition = 0; // <<< NEW: Tracks the top of the viewport in the virtual list
    let scrollTimeout = null; // For debouncing scroll events

    // --- Debounce Utility ---
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // --- NEW Helper: Create Slide Structure ---
    // Creates the empty DOM structure for a slide, to be put in the pool.
    // Returns the created slide element.
    function createSlideStructure(poolIndex) {
        console.log(`--- DEBUG: createSlideStructure for pool index ${poolIndex}`);
        // --- Create Elements Programmatically ---
        const newSlide = document.createElement('div');
        newSlide.classList.add('video-slide');
        newSlide.dataset.poolIndex = poolIndex; // Identify its position in the pool

        // Add placeholder styles for initial layout
        newSlide.style.width = '100%';
        newSlide.style.position = 'absolute'; // Needed for virtualization positioning later
        newSlide.style.top = `${poolIndex * 100}vh`; // Basic initial positioning

        const videoWrapper = document.createElement('div');
        videoWrapper.classList.add('video-wrapper');

        const player = document.createElement('video');
        player.classList.add('video-player');
        player.setAttribute('playsinline', ''); // Important for mobile
        player.setAttribute('webkit-playsinline', ''); // iOS Safari
        // player.loop = true; // Set during content update
        player.preload = 'metadata'; // Good default

        const videoOverlay = document.createElement('div');
        videoOverlay.classList.add('video-overlay');

        const videoInfo = document.createElement('div');
        videoInfo.classList.add('video-info');

        const pfpPlaceholder = document.createElement('div');
        pfpPlaceholder.classList.add('pfp-placeholder');

        const textInfo = document.createElement('div');
        textInfo.classList.add('text-info');

        const titleElement = document.createElement('h3');
        titleElement.classList.add('video-title');
        // titleElement.textContent = "Loading Title..."; // Placeholder

        const creatorElement = document.createElement('p');
        creatorElement.classList.add('video-creator');
        // creatorElement.textContent = "@loading..."; // Placeholder

        textInfo.appendChild(titleElement);
        textInfo.appendChild(creatorElement);
        videoInfo.appendChild(pfpPlaceholder);
        videoInfo.appendChild(textInfo);

        const muteButton = document.createElement('button');
        muteButton.classList.add('mute-button');
        muteButton.innerHTML = '<i class="fas fa-volume-mute"></i>';

        const likeButton = document.createElement('button');
        likeButton.classList.add('like-button');
        const likeIcon = document.createElement('i');
        likeIcon.classList.add('far', 'fa-heart');
        const likeCountElement = document.createElement('span');
        likeCountElement.classList.add('like-count');
        likeButton.appendChild(likeIcon);
        likeButton.appendChild(likeCountElement);

        const scrubBar = document.createElement('input');
        scrubBar.type = 'range';
        scrubBar.classList.add('scrub-bar');
        scrubBar.min = '0';
        scrubBar.max = '100';
        scrubBar.value = '0';
        scrubBar.step = '0.1';

        const playIndicator = document.createElement('div');
        playIndicator.classList.add('play-indicator');
        playIndicator.innerHTML = '<i class="fas fa-play"></i>';

        videoOverlay.appendChild(videoInfo);
        videoOverlay.appendChild(muteButton);
        videoOverlay.appendChild(likeButton);
        videoOverlay.appendChild(scrubBar);
        videoOverlay.appendChild(playIndicator);

        videoWrapper.appendChild(player);
        videoWrapper.appendChild(videoOverlay);
        newSlide.appendChild(videoWrapper);
        // --- End Element Creation ---

        // --- Don't set content here, just structure ---

        // Call resize functions AFTER appending? Or maybe better after content update?
        // Let's skip them here. They will be called by updateSlideContent.

        return newSlide;
    }
    // --- End NEW Helper ---

    // --- NEW: Update Slide Content Function ---
    function updateSlideContent(slideElement, videoData, dataIndex) {
        console.log(`--- DEBUG: updateSlideContent called for slideElement index ${slideElement.dataset.poolIndex}, dataIndex ${dataIndex}`);

        // --- Find elements within this specific slideElement ---
        // Moved element finding higher to use them for resets
        const player = slideElement.querySelector('.video-player');
        const titleElement = slideElement.querySelector('.video-title');
        const creatorElement = slideElement.querySelector('.video-creator');
        const likeButton = slideElement.querySelector('.like-button');
        const likeIcon = likeButton?.querySelector('i');
        const likeCountElement = likeButton?.querySelector('.like-count');
        const muteButton = slideElement.querySelector('.mute-button');
        const scrub = slideElement.querySelector('.scrub-bar');
        const pfpPlaceholder = slideElement.querySelector('.pfp-placeholder');
        const playIndicator = slideElement.querySelector('.play-indicator');
        const videoInfo = slideElement.querySelector('.video-info');

        // --- Reset Temporary UI States & Timers --- <<< NEW
        console.log(`--- DEBUG: Resetting UI state for pool index ${slideElement.dataset.poolIndex}`);
        if (playIndicator) playIndicator.classList.remove('visible');
        if (scrub) scrub.classList.remove('visible');
        if (videoInfo) videoInfo.classList.remove('info-active');
        if (titleElement) titleElement.classList.remove('title-expanded');

        // Clear timers
        if (slideElement.hideControlsTimer) {
            clearTimeout(slideElement.hideControlsTimer);
            slideElement.hideControlsTimer = null;
        }
        if (videoInfo && videoInfo.hideTimer) {
            clearTimeout(videoInfo.hideTimer);
            videoInfo.hideTimer = null;
        }
        // --- End Resets ---

        if (!videoData) {
            console.warn(`updateSlideContent: No video data provided for dataIndex ${dataIndex}. Hiding slide?`);
            // Optionally hide the slide element or show a placeholder
            slideElement.style.display = 'none'; // Example: Hide it
            return;
        }
         slideElement.style.display = ''; // Ensure it's visible if previously hidden

        // Store the data index for reference (e.g., in observer)
        slideElement.dataset.dataIndex = dataIndex;

        const { filename, title, creator } = videoData;
        console.log(`--- DEBUG: Updating slide content for pool index ${slideElement.dataset.poolIndex} with data for ${filename} (dataIndex ${dataIndex})`);

        // Check required elements again after potential early exit
        if (!player || !titleElement || !creatorElement || !likeButton || !likeIcon || !likeCountElement || !muteButton || !scrub || !pfpPlaceholder || !playIndicator || !videoInfo) {
            console.error(`updateSlideContent: Missing one or more child elements in slide for pool index ${slideElement.dataset.poolIndex}, dataIndex ${dataIndex}`);
            return;
        }

        // --- Update Content ---
        // 1. Video Source (handle carefully)
        const currentSrc = player.currentSrc || player.src;
        const newSrc = `${API_BASE_URL}/videos/${filename}`;
        if (!currentSrc || !currentSrc.endsWith(filename)) {
            console.log(`Updating video source for pool index ${slideElement.dataset.poolIndex} to ${filename}`);
            player.pause();
            player.removeAttribute('src');
            player.load(); // Reset
            player.src = newSrc;
            player.load(); // Load new source
        } else {
            console.log(`Video source for pool index ${slideElement.dataset.poolIndex} already set to ${filename}. Skipping source update.`);
        }
        player.loop = true; // Ensure loop is set
        player.muted = userMutedPreference; // Apply mute preference

        // 2. Title and Creator
        titleElement.textContent = title || "Unknown Title";
        creatorElement.textContent = creator || "@unknown_creator";

        // 3. Like Button State & Count (use videoStats)
        const stats = videoStats[filename];
        if (stats) {
            likeCountElement.textContent = formatLikeCount(stats.like_count);
            const isLiked = stats.is_liked_by_user;
            likeButton.classList.toggle('liked', isLiked);
            likeIcon.classList.toggle('fas', isLiked);
            likeIcon.classList.toggle('far', !isLiked);
        } else {
            likeCountElement.textContent = '0';
            likeButton.classList.remove('liked');
            likeIcon.classList.remove('fas');
            likeIcon.classList.add('far');
            console.warn(`updateSlideContent: videoStats missing for ${filename}. Defaulting like state.`);
        }

        // 4. Mute Button State
        updateSpecificMuteButton(muteButton, userMutedPreference);

        // 5. Scrub Bar Reset
        resetScrubBar(scrub);

        // 6. Apply Styles (Title Truncation, etc.)
        // We might need to re-run style updates specifically for this slide
        updateTitleStyles(); // Re-run for all slides might be inefficient but simple for now

        // 7. Ensure listeners are attached (they should be from pool creation)
        // attachSingleSlideListeners(slideElement, slideElement.dataset.poolIndex); // Re-attaching might be needed if elements were replaced, but we modified in place

        console.log(`--- DEBUG: updateSlideContent FINISHED for pool index ${slideElement.dataset.poolIndex}, dataIndex ${dataIndex}`);
    }
    // --- End NEW Function ---

    // --- Authentication Functions ---
    function signInWithGoogle() {
        auth.signInWithPopup(googleProvider)
            .then((result) => {
                console.log("Signed in successfully:", result.user);
                // Token will be retrieved by onAuthStateChanged
            }).catch((error) => {
                // Handle Errors here.
                const errorCode = error.code;
                const errorMessage = error.message;

                // Ignore the specific error caused by onAuthStateChanged firing before popup promise resolves
                if (errorCode === 'auth/cancelled-popup-request') {
                    console.warn("signInWithPopup cancelled, likely due to rapid state change via onAuthStateChanged. Login likely succeeded.");
                    return; // Don't show alert for this specific case
                }

                // Log and alert for other, genuine errors
                console.error("Google Sign-In Error:", errorCode, errorMessage);
                alert(`Login failed: ${errorMessage}`); 
            });
    }

    function signOutUser() {
        auth.signOut().then(() => {
            console.log("Sign-out successful.");
            // State reset will be handled by onAuthStateChanged
        }).catch((error) => {
            console.error("Sign-out error:", error);
        });
    }

    // --- Authentication State Listener ---
    auth.onAuthStateChanged(async (user) => {
        console.log("--- DEBUG: onAuthStateChanged triggered ---"); // DEBUG
        if (user) {
            // User is signed in.
            currentUser = user;
            console.log("Auth State Changed: User logged in", currentUser.uid, currentUser.photoURL);

            // Explicitly log the photoURL we are trying to use
            console.log("--- DEBUG: Attempting to set PFP. photoURL from Firebase:", currentUser.photoURL);

            // Update PFP
            if (userPfpElement) {
                 if (currentUser.photoURL) {
                     userPfpElement.src = currentUser.photoURL;
                     userPfpElement.style.backgroundColor = 'transparent'; // Clear placeholder color
                 } else {
                     // Handle case where user has no photoURL (show default/initials)
                     userPfpElement.src = ''; // Clear src if it was set previously
                     userPfpElement.style.backgroundColor = '#555'; // Ensure placeholder color
                     // TODO: Maybe add initials?
                 }
                 console.log("--- DEBUG: PFP Element Found. Set src to:", userPfpElement.src, "Set background:", userPfpElement.style.backgroundColor);
             } else {
                 console.error("--- DEBUG: userPfpElement with id 'user-pfp' NOT FOUND in the DOM!");
            }

            if (userInfoDiv) {
            userInfoDiv.style.display = 'flex'; // Show user info/logout
                console.log("--- DEBUG: Set userInfoDiv display to:", window.getComputedStyle(userInfoDiv).display);
            } else {
                 console.error("--- DEBUG: userInfoDiv with id 'user-info' NOT FOUND in the DOM!");
            }

            if (loginButton) {
            loginButton.style.display = 'none'; // Hide login
                console.log("--- DEBUG: Set loginButton display to:", window.getComputedStyle(loginButton).display);
            } else {
                 console.error("--- DEBUG: loginButton with id 'login-button' NOT FOUND in the DOM!");
            }

            // Also explicitly hide the old logout button if it exists
            if (logoutButton) {
                logoutButton.style.display = 'none';
            }

            try {
                currentIdToken = await user.getIdToken(true); // Force refresh token
                console.log("ID Token retrieved.");
                // Re-initialize or refresh data now that we are logged in
                if (!isInitialized) {
                    console.log("--- DEBUG: User logged in, calling initial initializeOrRefreshFeed... ---"); // DEBUG
                    await initializeOrRefreshFeed();
                } else {
                    console.log("--- DEBUG: User logged in (already init), calling refresh initializeOrRefreshFeed... ---") // DEBUG
                    await initializeOrRefreshFeed(); 
                }
            } catch (error) {
                console.error("Error getting ID token:", error);
                currentIdToken = null;
            }
        } else {
            // User is signed out.
             console.log("--- DEBUG: User logged out. ---"); // DEBUG
            currentUser = null;
            currentIdToken = null;
            userInfoDiv.style.display = 'none'; // Hide user info/logout
            loginButton.style.display = 'block'; // Show login
            // Hide dropdown if it was open
            if (authDropdown) authDropdown.classList.remove('visible');

            // If app was initialized, refresh data for anonymous view
            if (isInitialized) {
                 console.log("--- DEBUG: User logged out (already init), calling refresh initializeOrRefreshFeed... ---") // DEBUG
                 await initializeOrRefreshFeed(); 
            } else {
                 // If not initialized and user logs out (e.g. on initial load with no user)
                 // We still need to potentially load the feed for anonymous view
                 console.log("--- DEBUG: User logged out (not init), calling initial initializeOrRefreshFeed... ---"); // DEBUG
                 await initializeOrRefreshFeed();
            }
        }
    });

    // --- Auth Button Listeners ---
    loginButton.addEventListener('click', signInWithGoogle);

    // --- API Fetch Helper ---
    async function fetchWithAuth(url, options = {}) {
        const headers = { ...(options.headers || {}), 'Content-Type': 'application/json' };
        if (currentIdToken) {
            headers['Authorization'] = `Bearer ${currentIdToken}`;
            // console.log("fetchWithAuth: Sending token");
        } else {
            // console.log("fetchWithAuth: No token to send");
        }

        const fetchOptions = {
            ...options,
            headers: headers
        };

        // console.log(`fetchWithAuth: Fetching ${url} with options:`, fetchOptions);
        const response = await fetch(url, fetchOptions);
        // console.log(`fetchWithAuth: Response status for ${url}: ${response.status}`);
        return response;
    }

    // Fetch the NEXT video filename AND title from backend
    async function fetchNextVideoData() { // No longer needs excludeList
        if (isFetching || allVideosLoaded) {
            console.log(`fetchNextVideoData: Skipping fetch (isFetching: ${isFetching}, allVideosLoaded: ${allVideosLoaded})`);
            return null;
        }
        console.log("Attempting to fetch next video data..."); // Simplified log
        isFetching = true;
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/next_video`, {
                method: 'POST',
                // No body needed anymore, backend picks randomly from all
            });
             console.log(`fetchNextVideoData: Response status: ${response.status}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            // Check for filename only, as other fields might be null if no videos left
            if (data && data.filename) {
                console.log("Fetched next data:", data);
                 // Store stats (including like status)
                 videoStats[data.filename] = {
                     like_count: data.like_count,
                     is_liked_by_user: data.is_liked_by_user
                 };
                 console.log("Updated videoStats:", videoStats);
                return data; // Return the whole data object
            } else {
                console.log("Backend indicates all videos loaded or incomplete data returned.");
                allVideosLoaded = true;
                console.log("--- DEBUG: fetchNextVideoData - Setting allVideosLoaded = true"); // DEBUG
                return null;
            }
        } catch (error) {
            console.error("Failed to fetch next video data:", error);
            return null;
        } finally {
            isFetching = false;
             console.log("fetchNextVideoData: Fetch attempt finished.");
        }
    }

    // Attempt to load the next video DATA and add to list
    async function loadNextSlide() { // No longer needs exclude list argument
        console.log(`loadNextSlide DATA called. allVideosLoaded: ${allVideosLoaded}, isFetching: ${isFetching}`);
        if (allVideosLoaded || isFetching) {
            console.log("--- DEBUG: loadNextSlide - Skipping DATA fetch due to allVideosLoaded or isFetching."); // DEBUG
            return;
        }
        // Call fetcher without exclude list
        const nextVideoData = await fetchNextVideoData();
        console.log("--- DEBUG: loadNextSlide - Result from fetchNextVideoData:", nextVideoData); // DEBUG
        if (nextVideoData && nextVideoData.filename) { 
            // const nextSlideIndex = appContainer.children.length; // <<< OLD INDEXING
            console.log(`loadNextSlide: Got data ${JSON.stringify(nextVideoData)}, adding to availableVideos.`);
            // createAndAppendSlide(nextVideoData, nextSlideIndex); // <<< NO LONGER CREATE SLIDE HERE
            
            // --- Simply add data to the list --- <<< NEW
            // Always add the fetched data for infinite scroll, allowing duplicates
            availableVideos.push(nextVideoData);
            // videoStats is updated in fetchNextVideoData if needed (though less critical now)
            console.log("--- DEBUG: Added new video data (allowing duplicates). availableVideos length:", availableVideos.length);
            // Trigger an update of the visible range to potentially render the new slide if needed
            updateVisibleRange();
             // --- End Add Data ---
             
        } else {
            console.log("loadNextSlide: No next video data received, feed end reached likely.");
             allVideosLoaded = true; // Ensure flag is set
        }
    }

    async function fetchAvailableVideos(page = 1, limit = 10) { // Add parameters
        console.log(`Fetching video list page ${page}, limit ${limit}...`);
        // Clear previous videos if fetching the first page
        if (page === 1) {
            availableVideos = [];
            videoStats = {};
            loadedVideoFilenames = []; // Also clear loaded filenames on initial fetch
            allVideosLoaded = false; // Reset end-of-list flag
            console.log("Cleared existing video data for initial fetch.");
        }
        try {
            // Call paginated endpoint
            const response = await fetchWithAuth(`${API_BASE_URL}/videos?page=${page}&limit=${limit}`);
            if (!response.ok) {
                 console.error(`HTTP error fetching videos! status: ${response.status}`);
                 throw new Error(`HTTP error! status: ${response.status}`);
             }
            const paginatedData = await response.json();
            
            // Validate response structure
            if (!paginatedData || !Array.isArray(paginatedData.videos)) { 
                console.error("No videos received from backend or invalid format.");
                if (page === 1) { // Clear data only if first page failed
                availableVideos = [];
                     videoStats = {};
                 }
                return false; // Indicate fetch failed
            }
            
            const fetchedVideos = paginatedData.videos;
            console.log(`Fetched ${fetchedVideos.length} videos for page ${paginatedData.page}/${paginatedData.total_pages}. Total videos: ${paginatedData.total_videos}`);

            // Append new videos and update stats
            fetchedVideos.forEach(vid => {
                if (vid.filename && !videoStats[vid.filename]) { // Avoid duplicates if API somehow sends them
                     // Only add if not already in availableVideos (more robust check)
                     if (!availableVideos.some(existingVid => existingVid.filename === vid.filename)) {
                         availableVideos.push(vid);
                     }
                        videoStats[vid.filename] = {
                            like_count: vid.like_count,
                            is_liked_by_user: vid.is_liked_by_user
                        };
                    }
                });

            // Update state variables
            // We might need these later for loading more
            currentPage = paginatedData.page;
            totalPages = paginatedData.total_pages;
            if (currentPage >= totalPages) {
                allVideosLoaded = true;
                console.log("All video pages loaded.");
            }

            console.log("Current availableVideos count:", availableVideos.length);
            console.log("Initial videoStats populated/updated:", videoStats);
            return true; // Indicate success
        } catch (error) {
            console.error(`Could not fetch video list page ${page}:`, error);
             if (page === 1) { // Clear data only if first page failed
            availableVideos = [];
            videoStats = {};
             }
            return false; // Indicate fetch failed
        }
    }

    async function fetchAndLoadVideo(playerIndex, excludeList = []) {
         const player = players[playerIndex]; 
         if (!player) {
             console.warn(`Skipping load: Player invalid for index ${playerIndex}`);
             return;
         }

         console.log(`Fetching next video for player ${playerIndex + 1}, excluding:`, excludeList);
         try {
            const response = await fetch(`${API_BASE_URL}/next_video`, {
                 method: 'POST',
                 headers: {
                     'Content-Type': 'application/json',
                 },
                 body: JSON.stringify({ exclude: excludeList })
            });
             if (!response.ok) {
                 console.error(`HTTP error fetching next video! status: ${response.status}`);
                 throw new Error(`HTTP error! status: ${response.status}`);
             }
             const data = await response.json();
             const filename = data.filename;

             if (!filename) {
                 console.error("No filename received from /next_video endpoint.");
                 return;
             }

             // Load the fetched video
             loadVideoIntoPlayer(playerIndex, filename);

         } catch (error) {
             console.error(`Failed to fetch or load next video for player ${playerIndex + 1}:`, error);
             // Handle error appropriately - maybe retry or show message
         }
     }

    async function loadVideoIntoPlayer(playerIndex, filename) {
         const player = players[playerIndex]; // Get the stable player reference
         if (!filename || !player) {
             console.warn(`Skipping load: No filename or player invalid for index ${playerIndex}`);
             return;
         }
         // Avoid reloading the same video
         const currentSrc = player.currentSrc || player.src; // Handle both properties
         if (currentSrc && currentSrc.endsWith(filename)) {
              console.log(`Player ${playerIndex + 1} already has ${filename}. Skipping reload.`);
              player.muted = userMutedPreference;
              updateSpecificMuteButton(playerIndex);
              return;
          }

         console.log(`Loading ${filename} into player ${playerIndex + 1} (ID: ${player.id})`);
         currentVideoFilenames[playerIndex] = filename;
         
         // --- Stop playback and clear state before changing source --- 
         player.pause();
         player.removeAttribute('src'); // Remove src attribute
         player.load(); // Reset the media element state
         // --- End Reset --- 
         
         player.src = `${API_BASE_URL}/videos/${filename}`; // Set the new source
         player.load(); // Load the new source
         player.muted = userMutedPreference; 
         updateSpecificMuteButton(playerIndex); 
         resetScrubBar(playerIndex); 

         // --- Re-attach listeners (using .on... implicitly replaces old ones) ---
         // No need to clone/replace, just ensure listeners are attached
         // The attachSinglePlayerListeners function will be called during initialization
         // and should target the correct, stable elements.
         // We might need to call updateMuteButtonSize here though if metadata loads late
         player.onloadedmetadata = () => {
             updateMuteButtonSize(); // Ensure size is correct after metadata loads
         };
         
         player.onerror = (e) => {
             console.error(`Error loading video ${filename} into player ${playerIndex + 1}:`, e);
         };
         console.log(`Finished setting up player ${playerIndex + 1} for ${filename}`);
     }
     
    function attemptPlay(player) {
        if (!player) return;
         if (typeof player.play !== 'function') {
             console.warn(`Play function not available for ${player.id}`);
             return;
         }
         
        console.log(`--- DEBUG: attemptPlay called for player ${player.id}`); // DEBUG
        const playPromise = player.play();
        if (playPromise !== undefined) {
            playPromise.then(_ => {
                console.log(`--- DEBUG: Playback started successfully for ${player.id}`); // DEBUG
            }).catch(error => {
                 console.error(`--- DEBUG: Playback FAILED for ${player.id}:`, error); // DEBUG
                 // Check if it failed because it's already playing (less common, but possible)
                 if (error.name !== 'AbortError') {
                     // Perhaps show a play icon overlay? User must interact.
                 }
            });
        } else {
             console.warn(`--- DEBUG: player.play() did not return a promise for ${player.id}`); // DEBUG
        }
    }

    // --- Moved UI Update & Listener Attachment Functions Earlier --- 

    // Helper to attach listeners to a single slide 
     function attachSingleSlideListeners(slideElement, slideIndex) {
         // Use querySelector relative to the specific slide
         const player = slideElement.querySelector('.video-player');
         const scrub = slideElement.querySelector('.scrub-bar');
         const muteButton = slideElement.querySelector('.mute-button');
         const likeButton = slideElement.querySelector('.like-button'); // Get like button
         const videoInfo = slideElement.querySelector('.video-info'); // Get info container
         const playIndicator = slideElement.querySelector('.play-indicator'); // Get play indicator
         
         if(!player || !scrub || !muteButton || !likeButton || !videoInfo || !playIndicator || !videoInfo.querySelector('.video-title')) { 
             console.error(`Cannot attach listeners: Missing elements for slide index ${slideIndex}`);
             return;
         } 
         
         console.log(`--- DEBUG: Attaching listeners to slide ${slideIndex + 1}`); // DEBUG

         muteButton.onclick = (e) => { e.stopPropagation(); toggleMute(); }; 
         likeButton.onclick = (e) => { e.stopPropagation(); toggleLike(likeButton); };

         scrub.oninput = () => handleScrub(player, scrub);
         scrub.onchange = () => handleScrub(player, scrub);
         player.ontimeupdate = () => updateScrubBar(player, scrub);
         player.onclick = (event) => handleClickToPlayPause(event, player, slideIndex);
         player.onvolumechange = () => {
             userMutedPreference = player.muted;
             document.querySelectorAll('.mute-button').forEach(button => {
                 updateSpecificMuteButton(button, userMutedPreference);
             });
         };
         player.onended = () => resetScrubBar(scrub);
         player.onerror = (e) => console.error(`Error on player in slide ${slideIndex + 1}:`, e);

         // --- NEW: JS Hover logic for title --- 
         const titleElement = videoInfo.querySelector('.video-title');
         if (titleElement) {
            const containerWidth = appContainer.offsetWidth;
            const threshold = containerWidth * 0.98;
            
            videoInfo.onmouseenter = () => {
                 // Only remove truncation if it was actually applied
                 if (titleElement.style.maxWidth) {
                    console.log("Mouse enter: Expanding title");
                    removeTitleTruncation(titleElement);
                 }
            };
            videoInfo.onmouseleave = () => {
                 console.log("Mouse leave: Re-checking title truncation");
                 // Re-calculate threshold in case of resize during hover
                 const currentThreshold = appContainer.offsetWidth * 0.98;
                 applyTitleTruncationIfNeeded(titleElement, currentThreshold);
            };
         } else {
             console.warn(`Could not find title element in slide ${slideIndex + 1} for hover listeners.`);
         }
         // --- End JS Hover Logic ---

         // <<< RESTORE Video Info Tap Listener >>>
         videoInfo.onclick = (e) => {
             e.stopPropagation(); // Prevent player click handler
             console.log(`Video info tapped for slide ${slideIndex + 1}`);

             // Toggle classes
             videoInfo.classList.toggle('info-active');
             titleElement.classList.toggle('title-expanded');

             // Clear existing timer if it exists
             if (videoInfo.hideTimer) {
                 clearTimeout(videoInfo.hideTimer);
                 videoInfo.hideTimer = null; // Clear timer reference
             }

             // Set timer ONLY if classes were added (element is now active)
             if (videoInfo.classList.contains('info-active')) {
                 videoInfo.hideTimer = setTimeout(() => {
                     videoInfo.classList.remove('info-active');
                     titleElement.classList.remove('title-expanded');
                     console.log(`Hiding info background/expanded title after timeout (Slide ${slideIndex + 1})`);
                     videoInfo.hideTimer = null; // Clear timer reference after execution
                 }, 3000); // Hide after 3 seconds
             }
         };
         // <<< END RESTORE >>>

         playIndicator.onclick = (e) => {
             e.stopPropagation(); 
             console.log(`Play indicator explicitly clicked for slide ${slideIndex + 1}`);
             handleClickToPlayPause(e, player, slideIndex); 
         };
     }

     // --- Global UI Update Functions ---
     function toggleMute() {
         userMutedPreference = !userMutedPreference;
         initialMuteOverridden = true; // User manually toggled
         console.log(`Global mute toggled. New preference: ${userMutedPreference ? 'Muted' : 'Unmuted'}`);
         // Apply to all current and future players
         document.querySelectorAll('.video-player').forEach(p => {
             p.muted = userMutedPreference;
         });
         document.querySelectorAll('.mute-button').forEach(button => {
             updateSpecificMuteButton(button, userMutedPreference);
         });
     }

     function updateSpecificMuteButton(buttonElement, isMuted) {
         const icon = buttonElement?.querySelector('i');
         if (!icon) return;
         if (isMuted) {
             icon.classList.remove('fa-volume-high');
             icon.classList.add('fa-volume-mute');
         } else {
             icon.classList.remove('fa-volume-mute');
             icon.classList.add('fa-volume-high');
         }
     }

    function handleScrub(player, scrub) {
        if (!player || !scrub || !isFinite(player.duration)) return;
        const scrubTime = (scrub.value / 100) * player.duration;
        // console.log(`Scrubbing player in slide ${player.closest('.video-slide')?.dataset.slideIndex + 1} to ${scrubTime.toFixed(2)}s`);
        player.currentTime = scrubTime;
    }

    function updateScrubBar(player, scrub) {
        // Check if activeSlideIndex is valid before using it
        if (activeSlideIndex === -1) return;
        
        const slideElement = player.closest('.video-slide');
        if (!slideElement) return;
        const slideIndex = parseInt(slideElement.dataset.slideIndex, 10);
        
        const slideDataIndex = parseInt(slideElement.dataset.dataIndex, 10);

        // Compare the slide's CURRENT data index with the global active DATA index
        // Only update the scrub bar if this slide IS the active one
        if (isNaN(slideDataIndex) || slideDataIndex !== activeSlideIndex || !player || !scrub || !isFinite(player.duration) || player.duration === 0) {
            // Add a log to see why it might be skipping (temporary debug)
            // console.log(`--- DEBUG: updateScrubBar - Skipping update for dataIndex ${slideDataIndex} (Active: ${activeSlideIndex}, Player duration: ${player?.duration})`);
             return; 
         }
        // If we reach here, this IS the active slide, so update its scrub bar
        const percentage = (player.currentTime / player.duration) * 100;
        if (Math.abs(parseFloat(scrub.value) - percentage) > 0.1) {
            scrub.value = percentage;
            updateScrubBarBackground(scrub, percentage);
        }
    }

     function resetScrubBar(scrub) {
          if (!scrub) return;
          scrub.value = 0;
          // Reset background to default transparent grey
          scrub.style.background = 'rgba(200, 200, 200, 0.3)';
      }

    function updateScrubBarBackground(scrubElement, percentage) {
        if (!scrubElement) return;
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        // Use transparent grey for inactive part
        const inactiveColor = 'rgba(200, 200, 200, 0.3)'; 
        scrubElement.style.background = `linear-gradient(to right, red ${clampedPercentage}%, red ${clampedPercentage}%, ${inactiveColor} ${clampedPercentage}%, ${inactiveColor} 100%)`;
    }

    function handleClickToPlayPause(event, player, index) {
        // Ignore clicks directly on the scrub bar
        if (event.target.classList.contains('scrub-bar')) {
            console.log("Click on scrub bar ignored by play/pause handler.");
            return; 
        }
        
        // <<< START NEW LOGIC for bottom tap >>>
        const playerRect = player.getBoundingClientRect();
        const clickYRelativeToPlayer = event.clientY - playerRect.top;
        const bottomThreshold = playerRect.height * 0.80; // Bottom 20% starts here

        if (clickYRelativeToPlayer > bottomThreshold) {
            const slide = player.closest('.video-slide');
            const scrubBar = slide?.querySelector('.scrub-bar');
            // const videoInfo = slide?.querySelector('.video-info'); // <<< REMOVE: No longer needed here
            
            if (scrubBar) { // <<< Check only scrubBar exists
                console.log("Tap in bottom area: showing scrub bar."); // Update log message
                
                // Use a shared timer property, e.g., on the slide itself
                if (slide.hideControlsTimer) {
                    clearTimeout(slide.hideControlsTimer);
                }

                // Show the scrub bar
                scrubBar.classList.add('visible');
                // videoInfo.classList.add('visible-background'); // <<< REMOVE class toggle for info
                
                // Set a timer to hide only the scrub bar again
                slide.hideControlsTimer = setTimeout(() => {
                    scrubBar.classList.remove('visible');
                    // videoInfo.classList.remove('visible-background'); // <<< REMOVE class toggle for info
                    console.log("Hiding scrub bar after timeout."); // Update log message
                }, 3000); 
            }
            return; // Prevent play/pause toggle
        }
        // <<< END MODIFIED LOGIC >>>

        // --- Original Play/Pause Logic (if click not in bottom area or on scrub bar) ---
        console.log(`handleClickToPlayPause called for slide index: ${index}, activeSlideIndex: ${activeSlideIndex}`);
        if (!player) {
             console.error("handleClickToPlayPause Error: Player element is invalid!");
             return;
         }
        
        // Get the DATA index of the slide that was clicked
        const clickedSlideElement = player.closest('.video-slide');
        const clickedDataIndex = parseInt(clickedSlideElement?.dataset.dataIndex, 10);

        if (isNaN(clickedDataIndex)) {
            console.error("handleClickToPlayPause Error: Could not determine data index of clicked slide!");
             return;
         }
        
        // If it's not the active player, scroll to it. Observer will handle play.
        if (clickedDataIndex !== activeSlideIndex) {
             console.log(`Clicked non-active slide ${index + 1}, scrolling.`);
             player.closest('.video-slide')?.scrollIntoView({ behavior: 'smooth' });
             return;
        }
        
        // If it IS the active player:
        console.log(`Player state before click logic: muted=${player.muted}, paused=${player.paused}, userMutedPreference=${userMutedPreference}, initialMuteOverridden=${initialMuteOverridden}`);

        const isInitialMuteCondition = !initialMuteOverridden && player.muted;
        console.log(`Checking initial unmute condition: !initialMuteOverridden (${!initialMuteOverridden}) && player.muted (${player.muted}) => Result: ${isInitialMuteCondition}`);

        // Priority 1: ONE-TIME initial unmute via click
        if (isInitialMuteCondition) { 
            console.log("Initial click condition MET. Unmuting THIS player and playing.");
            player.muted = false; 
            userMutedPreference = false; 
            initialMuteOverridden = true; 
            const muteButton = player.closest('.video-slide')?.querySelector('.mute-button');
            if (muteButton) updateSpecificMuteButton(muteButton, false);
            attemptPlay(player);
        } else { 
            // Priority 2: Standard Play/Pause toggle 
             console.log("Initial click condition NOT MET. Proceeding to standard toggle play/pause.");
            if (player.paused) {
                 console.log(`Resuming player in slide ${index + 1}`);
                attemptPlay(player);
            } else {
                 console.log(`Pausing player in slide ${index + 1}`);
                player.pause();
            }
        }

        // Update play indicator visibility
        const playIndicator = player.closest('.video-slide')?.querySelector('.play-indicator');
        if (playIndicator) {
            console.log(`Play indicator found for slide ${index + 1}. Player paused: ${player.paused}, InitialMuteCondition: ${isInitialMuteCondition}`);
            if (player.paused && !isInitialMuteCondition) { 
                console.log(`Adding 'visible' class to play indicator.`);
                playIndicator.classList.add('visible');
            } else {
                console.log(`Removing 'visible' class from play indicator.`);
                playIndicator.classList.remove('visible');
            }
        }
    }

    // --- Button Padding Helper ---
    function setButtonPadding(button, scaleFactor = 0.2) {
        if (!button || !button.style.width) return; // Need width to be set
        const buttonSize = parseFloat(button.style.width);
        if (isNaN(buttonSize) || buttonSize <= 0) return;

        const padding = buttonSize * scaleFactor;
        button.style.padding = `${padding}px`;
        // console.log(`Set padding for button to ${padding}px`);
    }

    // Update ALL mute buttons based on container width
    function updateMuteButtonSize() {
        console.log("Updating ALL mute button sizes.");
        if (!appContainer) return;
        const containerWidth = appContainer.offsetWidth;
        if (containerWidth === 0) {
            console.warn("updateMuteButtonSize: Container width is 0, skipping resize.");
            return; 
        }
        // Removed Math.max for minimum size
        const buttonSize = containerWidth / 10; 
        const fontSize = buttonSize * 0.5;
        console.log(`Mute Button - Size: ${buttonSize}px, Font: ${fontSize}px`);

        // Select ALL mute buttons currently in the DOM
        document.querySelectorAll('.mute-button').forEach(button => {
            if (!button) return;
            button.style.width = `${buttonSize}px`;
            button.style.height = `${buttonSize}px`;
            button.style.fontSize = `${fontSize}px`;
            setButtonPadding(button, 0.2); // Set padding relative to size (20%)
        });
    }

    // --- NEW: Format Like Count ---
    function formatLikeCount(num) {
        if (num === null || num === undefined || isNaN(num)) {
            return '0'; // Return '0' for invalid input
        }
        if (num < 1000) {
            return num.toString();
        }
        // Handle thousands (e.g., 1643 -> 1.6K, 1000 -> 1K)
        const thousands = num / 1000;
        // Use toFixed(1) and remove trailing '.0' if present
        return thousands.toFixed(1).replace(/\.0$/, '') + 'K';
        // Add logic for millions (M), billions (B) if needed later
    }

    // --- NEW: Like Button Toggle Logic --- (Major Changes)
    async function toggleLike(likeButton) {
        if (!likeButton) return;

        const slide = likeButton.closest('.video-slide');
        const player = slide?.querySelector('.video-player');
        const filename = player?.currentSrc?.split('/').pop();

        if (!filename) {
            console.error("Could not determine filename for like action.");
            return;
        }

        // --- Authentication Check --- >> NEW <<
        if (!currentUser) {
            console.log("User not logged in. Prompting login.");
            signInWithGoogle(); // <<< Directly trigger Google Sign-In
            return; // Stop the function here
        }
        // --- End Authentication Check ---

        const icon = likeButton.querySelector('i');
        const likeCountSpan = likeButton.querySelector('.like-count');
        if (!icon || !likeCountSpan) return;

        // Determine action based on CURRENT visual state (or stored state if more reliable)
        // Let's use the '.liked' class as the source of truth before the API call
        const isCurrentlyLiked = likeButton.classList.contains('liked');
        const action = isCurrentlyLiked ? 'unlike' : 'like';
        console.log(`Like button clicked for ${filename}. Current visual state: ${isCurrentlyLiked ? 'Liked' : 'Unliked'}. Determined action: ${action}`);

        // --- Optimistic UI Update --- (Still useful for immediate feedback)
        likeButton.classList.toggle('liked', !isCurrentlyLiked); // Set class based on NEW state
        if (!isCurrentlyLiked) { // If action is 'like'
            icon.classList.remove('far'); icon.classList.add('fas');
        } else { // If action is 'unlike'
            icon.classList.remove('fas'); icon.classList.add('far');
        }
        // Note: We don't optimistically update the count here, wait for backend response

        // Send request to backend using fetchWithAuth
        try {
            console.log(`Sending ${action} request for ${filename} with token: ${currentIdToken ? 'Yes' : 'No'}`);
            const response = await fetchWithAuth(`${API_BASE_URL}/videos/${filename}/like`, {
                method: 'POST',
                body: JSON.stringify({ action: action })
            });

            const result = await response.json(); // Try to parse JSON regardless of status for error messages
            console.log(`Backend response for ${action} ${filename} (Status ${response.status}):`, result);

            if (!response.ok) {
                // Handle specific errors (like 401 Unauthorized)
                if (response.status === 401) {
                    alert("Authentication error. Please log in again.");
                    // Optionally sign out the user or refresh token
                } else {
                     alert(`Error: ${result.message || 'Could not perform action.'}`);
                }
                throw new Error(`HTTP error! status: ${response.status} - ${result.message || 'Unknown error'}`);
            }

            // --- Update UI based on Definitive Backend Response --- << NEW FOCUS
            console.log("Backend success. Updating UI definitively.");
            likeCountSpan.textContent = formatLikeCount(result.like_count);
            // Ensure visual state matches backend state
            const backendLikedState = result.is_liked_by_user;
            likeButton.classList.toggle('liked', backendLikedState);
            if (backendLikedState) {
                icon.classList.remove('far'); icon.classList.add('fas');
            } else {
                icon.classList.remove('fas'); icon.classList.add('far');
            }
            // Update local cache if needed (videoStats)
             if (videoStats[filename]) {
                 videoStats[filename].like_count = result.like_count;
                 videoStats[filename].is_liked_by_user = result.is_liked_by_user;
             }

        } catch (error) {
            console.error(`Failed to ${action} video ${filename}:`, error);
            // --- Revert Optimistic UI on Error --- << IMPORTANT
            console.log("Reverting optimistic UI due to error.");
            likeButton.classList.toggle('liked', isCurrentlyLiked); // Revert to original state
            if (isCurrentlyLiked) { // If it WAS liked before the failed attempt
                 icon.classList.remove('far'); icon.classList.add('fas');
            } else { // If it WASN'T liked before the failed attempt
                 icon.classList.remove('fas'); icon.classList.add('far');
            }
            // Optionally show error to user (already done in response handling)
        }
    }

    // --- NEW: Update Like Button Size (similar to mute) ---
    function updateLikeButtonSize() {
        console.log("Updating ALL like button sizes.");
        if (!appContainer) return;
        const containerWidth = appContainer.offsetWidth;
        if (containerWidth === 0) {
            console.warn("updateLikeButtonSize: Container width is 0, skipping resize.");
            return;
        }
        // Removed Math.max for minimum size
        const buttonSize = containerWidth / 10; // Same size as mute
        const fontSize = buttonSize * 0.5;
        console.log(`Like Button - Size: ${buttonSize}px, Font: ${fontSize}px`);

        document.querySelectorAll('.like-button').forEach(button => {
            if (!button) return;
            button.style.width = `${buttonSize}px`;
            button.style.height = `${buttonSize}px`;
            button.style.fontSize = `${fontSize}px`;
            setButtonPadding(button, 0.1); // Set less padding (10%) as no background
        });
    }

    // --- NEW: Title Truncation Helper Functions ---
    function removeTitleTruncation(titleElement) {
        if (!titleElement) return;
        titleElement.style.maxWidth = '';
        titleElement.style.whiteSpace = '';
        titleElement.style.overflow = '';
        titleElement.style.textOverflow = '';
    }

    function applyTitleTruncationIfNeeded(titleElement, threshold) {
        if (!titleElement) return;

        // Reset first to measure correctly
        removeTitleTruncation(titleElement);

        const actualWidth = titleElement.scrollWidth;
        // console.log(`Checking Truncation: Actual Width: ${actualWidth}, Threshold: ${threshold}`);

        if (actualWidth > threshold) {
            // console.log("Applying truncation.");
            titleElement.style.maxWidth = `${threshold}px`;
            titleElement.style.whiteSpace = 'nowrap';
            titleElement.style.overflow = 'hidden';
            titleElement.style.textOverflow = 'ellipsis';
        } else {
            // console.log("No truncation needed.");
            // Styles already reset
        }
    }

    // --- NEW: Update Title Position & Size --- 
    function updateTitleStyles() {
        console.log("--- Running updateTitleStyles ---");
        if (!appContainer) {
            console.error("updateTitleStyles: appContainer not found!");
            return;
        }
        const containerWidth = appContainer.offsetWidth;
        const containerHeight = appContainer.offsetHeight;
        if (containerWidth === 0 || containerHeight === 0) {
            console.warn("updateTitleStyles: Container dimensions are 0, skipping resize.");
            return; 
        }

        // Calculate relative values (adjust percentages as needed)
        // INCREASED bottom offset significantly to avoid scrub bar overlap
        // Increase bottom offset further to clear the bottom-pinned scrub bar
        const bottomOffset = containerHeight * 0.10; // Was 0.07
        const leftOffset = containerWidth * 0.03;   // Keep horizontal offset 
        const fontSize = containerWidth * 0.032; // Was 0.035
        const paddingTB = Math.max(4, fontSize * 0.4); // Keep TB for potential future use, but not applying

        // Calculate PFP size relative to font size
        const pfpSize = containerWidth * 0.055; // Was 0.06

        console.log(`Calculated Styles (Reduced) - Bottom: ${bottomOffset.toFixed(2)}px, Left: ${leftOffset.toFixed(2)}px, Shared FontSize: ${fontSize.toFixed(2)}px, PFP Size: ${pfpSize.toFixed(2)}px`);

        const truncationThreshold = containerWidth * 0.98; // INCREASED 98% width threshold

        document.querySelectorAll('.video-info').forEach(infoDiv => {
             if (!infoDiv) {
                 console.error("updateTitleStyles: Found null infoDiv in querySelectorAll result.");
                 return;
             } 
             const slideIndexForLog = infoDiv.closest('.video-slide')?.dataset.slideIndex ?? 'unknown';
             console.log(`Applying styles to .video-info for slide index: ${slideIndexForLog}`);
              infoDiv.style.bottom = `${bottomOffset}px`;
              infoDiv.style.left = `${leftOffset}px`;
              
              const titleElement = infoDiv.querySelector('.video-title');
              if (!titleElement) {
                  console.error(`updateTitleStyles: Could not find .video-title inside .video-info for slide index: ${slideIndexForLog}`);
                  return;
              }
              
              // Apply basic styles first
              titleElement.style.fontSize = `${fontSize}px`;
              titleElement.style.padding = `${paddingTB}px 0px`; // Removed padding application

              // Find creator element and apply its font size
              const creatorElement = infoDiv.querySelector('.video-creator');
              if (creatorElement) {
                  creatorElement.style.fontSize = `${fontSize}px`; // Apply same font size as title
              } else {
                  console.error(`updateTitleStyles: Could not find .video-creator for slide index: ${slideIndexForLog}`);
              }

              // Find PFP element and apply its size
              const pfpElement = infoDiv.querySelector('.pfp-placeholder');
              if (pfpElement) {
                  pfpElement.style.width = `${pfpSize}px`;
                  pfpElement.style.height = `${pfpSize}px`;
              } else {
                   console.error(`updateTitleStyles: Could not find .pfp-placeholder for slide index: ${slideIndexForLog}`);
              }

              // --- Dynamic Truncation Logic ---
              // Use the helper function to apply truncation
              applyTitleTruncationIfNeeded(titleElement, truncationThreshold);
              // --- End Dynamic Truncation ---
          });
          console.log("--- Finished updateTitleStyles ---");
    }
    // --- End NEW Function ---

    function shuffleArray(array) { /* ... (utility) ... */ }

    // --- Intersection Observer --- 
    function setupIntersectionObserver() {
        if (!appContainer) {
            console.error("App container not found!");
            return;
        }
        console.log("--- DEBUG: Setting up Intersection Observer... ---"); // DEBUG
        const options = {
            root: appContainer,
            rootMargin: '0px',
            threshold: 0.6 // Keep threshold for triggering play/pause
        };

        observer = new IntersectionObserver((entries) => {
            console.log(`--- DEBUG: Intersection Observer Callback Fired (${entries.length} entries) ---`);
            let bestEntry = null;
            let maxRatio = 0;

            entries.forEach(entry => {
                const poolIndex = parseInt(entry.target.dataset.poolIndex, 10);
                const currentDataIndex = parseInt(entry.target.dataset.dataIndex, 10);
                console.log(`--- DEBUG: Observer Entry - Pool Index: ${poolIndex}, Data Index: ${isNaN(currentDataIndex) ? 'N/A' : currentDataIndex}, Intersecting: ${entry.isIntersecting}, Ratio: ${entry.intersectionRatio.toFixed(2)}`);

                // Find the most visible slide (highest intersection ratio)
                if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
                    maxRatio = entry.intersectionRatio;
                        bestEntry = entry;
                 }
             });

            // --- Update Visible Slides Content & Position (using scroll event instead for better perf?) ---
            // For now, let's try updating based on observer triggers. We need a function for this.
             updateVisibleRange(); // <<< NEW function call to handle content/position updates

            // --- Handle Play/Pause based on Intersection --- 
            if (bestEntry && maxRatio >= options.threshold) {
                const bestSlideElement = bestEntry.target;
                const newDataIndex = parseInt(bestSlideElement.dataset.dataIndex, 10);

                if (!isNaN(newDataIndex) && newDataIndex < availableVideos.length && newDataIndex !== activeSlideIndex) { // Check bounds
                    console.log(`--- DEBUG: Intersection Change - New active DATA index: ${newDataIndex}`);

                    // Pause previously active video (if any)
                    if (activeSlideIndex !== -1 && activeSlideIndex < availableVideos.length) {
                        // Find the slide element *currently displaying* the old active data index
                        const oldSlide = slidePool.find(slide => parseInt(slide.dataset.dataIndex, 10) === activeSlideIndex);
                        if (oldSlide) {
                            const oldPlayer = oldSlide.querySelector('.video-player');
                            const oldScrub = oldSlide.querySelector('.scrub-bar');
                            if (oldPlayer) {
                                oldPlayer.pause();
                                oldPlayer.currentTime = 0; 
                                console.log(`--- DEBUG: Paused and Reset player for old data index ${activeSlideIndex}`);
                            }
                            if (oldScrub) resetScrubBar(oldScrub);
                            const oldPlayIndicator = oldSlide.querySelector('.play-indicator');
                            if (oldPlayIndicator) oldPlayIndicator.classList.remove('visible');
                        } else {
                             console.log(`--- DEBUG: Could not find slide displaying previous data index ${activeSlideIndex} to pause.`);
                        }
                    }
                    
                    // Set new active index (Data Index)
                    activeSlideIndex = newDataIndex;

                    // Play the new active video 
                    const activePlayer = bestSlideElement.querySelector('.video-player');
                    if (activePlayer) {
                        console.log(`--- DEBUG: Observer attempting to play new active data index ${activeSlideIndex}`);
                         activePlayer.muted = userMutedPreference; 
                         attemptPlay(activePlayer);
                        // Ensure its play indicator is hidden
                        const currentPlayIndicator = bestSlideElement.querySelector('.play-indicator');
                        if (currentPlayIndicator) currentPlayIndicator.classList.remove('visible');
                    } else {
                         console.error(`--- DEBUG: Could not find player element for active data index ${activeSlideIndex}`);
                    }

                    // Update URL Hash
                    const videoDataForURL = availableVideos[activeSlideIndex];
                    if (videoDataForURL && videoDataForURL.filename) {
                        const newQueryParam = `?video=${videoDataForURL.filename}`;
                        // Only push state if hash actually changes to prevent loop with handleHashChange
                        if (window.location.search !== newQueryParam) {
                            history.pushState({ videoFilename: videoDataForURL.filename }, "", newQueryParam);
                            console.log(`--- DEBUG: Updated URL query param to ${newQueryParam}`);
                        }
                    } else {
                        console.warn(`--- DEBUG: Could not find video data or filename for query param update (dataIndex: ${activeSlideIndex})`);
                    }

                } else if (!isNaN(newDataIndex) && newDataIndex === activeSlideIndex) {
                    // Re-focus on the already active slide, ensure it's playing
                    const currentPlayer = bestSlideElement.querySelector('.video-player');
                    if (currentPlayer && currentPlayer.paused) {
                        console.log(`--- DEBUG: Observer - Re-focus on active data index ${activeSlideIndex}, ensuring play.`);
                         attemptPlay(currentPlayer);
                    }
                }
            } else if (!bestEntry) {
                // No slide is intersecting significantly - potentially pause the active video?
                // This might be too aggressive if scrolling fast. Let's leave it playing for now.
                console.log("--- DEBUG: Observer - No slide is significantly intersecting.");
            }
        }, options);
         console.log("--- DEBUG: Intersection Observer setup complete. ---");
        // Initial observation is handled by initializeOrRefreshFeed
    }

    // --- NEW: Function to Update Visible Slide Content and Position ---
    function updateVisibleRange() {
        if (!appContainer || slidePool.length === 0 || availableVideos.length === 0) {
            // console.log("updateVisibleRange: Skipping, prerequisites not met.");
            return;
        }

        const scrollTop = appContainer.scrollTop;
        const containerHeight = appContainer.offsetHeight;
        // Assume uniform slide height - get it from the first pooled element
        const slideHeight = containerHeight;

        if (slideHeight <= 0) {
            console.warn("updateVisibleRange: Slide height is 0, cannot calculate range. Skipping.");
            return;
        }

        // Calculate the data index range that should be rendered
        // Add a buffer (e.g., 1 slide above/below visible area) for smoother scrolling
        const bufferSlides = 1;
        const firstVisibleDataIndex = Math.floor(scrollTop / slideHeight);
        const lastVisibleDataIndex = Math.floor((scrollTop + containerHeight - 1) / slideHeight);

        const firstDataIndexToRender = Math.max(0, firstVisibleDataIndex - bufferSlides);
        const lastDataIndexToRender = Math.min(availableVideos.length - 1, lastVisibleDataIndex + bufferSlides);

        console.log(`--- DEBUG: updateVisibleRange ---`);
        console.log(`  ScrollTop: ${scrollTop.toFixed(0)}, ViewportH: ${containerHeight}`);
        console.log(`  SlideHeight: ${slideHeight}`);
        console.log(`  Visible Data Index Range: ${firstVisibleDataIndex} - ${lastVisibleDataIndex}`);
        console.log(`  Render Data Index Range: ${firstDataIndexToRender} - ${lastDataIndexToRender}`);

        // --- Loop through slidePool and update content/position --- 
        const updatedPoolIndices = new Set(); // Keep track of which pool slots we used

        for (let dataIndex = firstDataIndexToRender; dataIndex <= lastDataIndexToRender; dataIndex++) {
            if (dataIndex >= availableVideos.length) break; // Don't go beyond available data

            const poolIndex = dataIndex % SLIDE_POOL_SIZE;
            const slideElement = slidePool[poolIndex];
            const currentSlideDataIndex = parseInt(slideElement.dataset.dataIndex, 10);
            const videoData = availableVideos[dataIndex];

            // Position the slide correctly based on its dataIndex
            const paddingHeight = slideHeight * 0.05; // 5vh padding
            const totalHeightPerSlide = slideHeight + paddingHeight;
            const expectedTop = dataIndex * totalHeightPerSlide;
            // Only update position if it's significantly different (performance)
            if (Math.abs(parseFloat(slideElement.style.top || '0') - expectedTop) > 1) {
                 console.log(`--- DEBUG: Positioning pool index ${poolIndex} for data index ${dataIndex} at top: ${expectedTop}px`);
                slideElement.style.top = `${expectedTop}px`;
            }

            // Update content ONLY if it's not already displaying the correct data
            if (isNaN(currentSlideDataIndex) || currentSlideDataIndex !== dataIndex) {
                 console.log(`--- DEBUG: Updating content for pool index ${poolIndex} with new data index ${dataIndex}`);
                updateSlideContent(slideElement, videoData, dataIndex);
            } else {
                 // Ensure it's visible if it was previously hidden
                 slideElement.style.display = ''; 
            }

            updatedPoolIndices.add(poolIndex); // Mark this pool index as used/updated
        }

        // Hide any pool elements that weren't updated (i.e., outside the render range)
        for (let i = 0; i < SLIDE_POOL_SIZE; i++) {
            if (!updatedPoolIndices.has(i)) {
                if (slidePool[i].style.display !== 'none') {
                     console.log(`--- DEBUG: Hiding unused pool index ${i}`);
                    slidePool[i].style.display = 'none';
                 }
            }
        }

        // --- Load More Data Trigger --- 
        const loadThreshold = 3; // Load more when within X slides of the end of loaded data
        if (!allVideosLoaded && !isFetching && (lastDataIndexToRender >= availableVideos.length - loadThreshold)) {
            console.log(`--- DEBUG: updateVisibleRange - Near end of loaded data (last render index ${lastDataIndexToRender} / total loaded ${availableVideos.length}), triggering loadNextSlide.`);
            loadNextSlide(); // Fetch next batch of data
        }
         console.log(`--- DEBUG: updateVisibleRange FINISHED ---`);
    }
    // --- End NEW Function ---

    // --- Initialization Function (Refactored) ---
    async function initializeOrRefreshFeed() {
        console.log("--- DEBUG: initializeOrRefreshFeed START (Virtualization Version) --- "); // DEBUG
        isInitialized = false; 
        clearFeed(); // clearFeed also needs modification

        // --- Create Fixed Slide Pool --- <<< NEW
        console.log(`--- DEBUG: Creating slide pool of size ${SLIDE_POOL_SIZE}`);
        slidePool = []; // Clear any previous pool
        appContainer.innerHTML = ''; // Clear container before adding pool
        for (let i = 0; i < SLIDE_POOL_SIZE; i++) {
            const poolSlideElement = createSlideStructure(i); // Use helper to create base structure
            if (poolSlideElement) {
                slidePool.push(poolSlideElement);
                appContainer.appendChild(poolSlideElement);
                // Attach listeners ONCE during creation
                attachSingleSlideListeners(poolSlideElement, i); // Pass pool index for potential debugging
            } else {
                 console.error(`Failed to create structure for pool slide index ${i}`);
            }
        }
        console.log("--- DEBUG: Slide pool created and appended.");
        // --- End Pool Creation ---

        let requestedFilename = null;
        let videoDataToLoadFirst = null;
        let initialExcludeList = [];

        // --- Check for initial video query parameter --- <<< MODIFIED
        const urlParams = new URLSearchParams(window.location.search);
        requestedFilename = urlParams.get('video'); // Get ?video=... value
        if (requestedFilename) {
             console.log(`--- DEBUG: Found requested filename in query parameter: ${requestedFilename}`);
            // Fetch details for this specific video first
            try {
                const response = await fetchWithAuth(`${API_BASE_URL}/video_details/${requestedFilename}`);
                if (response.ok) {
                    videoDataToLoadFirst = await response.json();
                    if (videoDataToLoadFirst && videoDataToLoadFirst.filename) {
                         console.log(`--- DEBUG: Successfully fetched details for hash video: ${requestedFilename}`);
                         initialExcludeList.push(videoDataToLoadFirst.filename); // Exclude this from next fetch
                         // Pre-populate stats for this video
                         videoStats[videoDataToLoadFirst.filename] = { 
                             like_count: videoDataToLoadFirst.like_count,
                             is_liked_by_user: videoDataToLoadFirst.is_liked_by_user
                         };
        } else {
                        console.warn(`--- DEBUG: Invalid data from /video_details for ${requestedFilename}. Falling back.`);
                        requestedFilename = null; // Clear request if fetch failed
                    }
                } else {
                    console.warn(`--- DEBUG: Failed to fetch /video_details for ${requestedFilename} (Status: ${response.status}). Falling back.`);
                    requestedFilename = null; // Clear request if fetch failed
                }
            } catch (err) {
                 console.error(`--- DEBUG: Error fetching /video_details for ${requestedFilename}:`, err);
                 requestedFilename = null;
            }
        }
        // --- End hash check/fetch ---

        // --- Fetch initial batch (unless we already loaded from hash) --- 
        if (!videoDataToLoadFirst) {
            const fetchSuccess = await fetchAvailableVideos(1); // Fetch page 1
            if (!fetchSuccess || availableVideos.length === 0) {
                console.error("Initialization failed: No initial videos available or fetch failed.");
                isInitialized = true; 
             return;
         }
            // Get the first video from the fetched batch
            videoDataToLoadFirst = availableVideos.find(v => v && v.filename); 
            if (videoDataToLoadFirst) {
                initialExcludeList.push(videoDataToLoadFirst.filename); // Exclude this from next fetch
            } else {
                 console.warn("fetchAvailableVideos succeeded but couldn't find a valid first video in the results.");
            }
        } else {
            // --- Ensure the hash-loaded video is in availableVideos --- <<< FIX
            console.log(`--- DEBUG: Adding hash-loaded video (${videoDataToLoadFirst.filename}) to availableVideos array.`);
            availableVideos = [videoDataToLoadFirst]; // Start the array with the hash video
            // videoStats were already populated during the fetch
            // initialExcludeList was already populated
        }
        // --- End initial batch fetch --- 

        if (!videoDataToLoadFirst) {
             console.error("Initialization failed: Could not determine a valid first video to load.");
             isInitialized = true;
             return;
        }
         console.log(`--- DEBUG: initializeOrRefreshFeed - Determined first video: ${videoDataToLoadFirst.filename}`); // DEBUG
        
        // --- Populate Initial Slides --- <<< NEW
        console.log("--- DEBUG: Populating initial slides from fetched data.");
        for (let i = 0; i < slidePool.length; i++) {
            // Find the corresponding data. For init, dataIndex matches pool index (i)
            // This assumes availableVideos is populated correctly before this loop
            const dataIndex = i; // Simplification for initial load
            const videoData = availableVideos[dataIndex]; 
            if (videoData) {
                updateSlideContent(slidePool[i], videoData, dataIndex);
        } else {
                 // Handle cases where there are fewer initial videos than the pool size
                 updateSlideContent(slidePool[i], null, dataIndex); // Hide unused slides
                 console.log(`--- DEBUG: No initial data for pool index ${i}. Slide will be hidden.`);
            }
        }
        const firstSlideElement = slidePool[0]; // Reference for potential scroll target
        // --- End Populate Initial Slides ---
        
        if (!firstSlideElement) {
            console.error("Failed to create the initial slide element.");
             isInitialized = true;
            return;
        }
        
        // --- Scroll to target if loaded from hash --- 
        if (requestedFilename) { 
            console.log(`--- DEBUG: Scrolling immediately to initial slide for ${requestedFilename}`);
             firstSlideElement.scrollIntoView(); 
             activeSlideIndex = 0; 
        }
        // --- End scroll --- 

        // --- Observer Setup --- 
        if (!observer) {
             console.log("--- DEBUG: initializeOrRefreshFeed - Observer doesn't exist, calling setupIntersectionObserver..."); // DEBUG
             setupIntersectionObserver(); 
             if (observer) {
                 console.log(`--- DEBUG: initializeOrRefreshFeed - Observer created. Observing initial pool slides.`); // DEBUG
                 slidePool.forEach(slide => observer.observe(slide)); // Observe all pooled slides
         } else {
                 console.error("--- DEBUG: initializeOrRefreshFeed - setupIntersectionObserver failed to create observer!"); // DEBUG
             }
        } else {
             console.log("--- DEBUG: initializeOrRefreshFeed - Observer already exists. Disconnecting and re-observing pool.");
             observer.disconnect(); // Stop observing old things
             slidePool.forEach(slide => observer.observe(slide)); // Observe all pooled slides
        }
        // --- End Observer Setup ---
        
        isInitialized = true;
        console.log("--- DEBUG: initializeOrRefreshFeed - Initialization state set to true."); // DEBUG

        // --- Load subsequent videos --- 
        console.log("--- DEBUG: Scheduling initial loadNextSlide DATA call."); // Changed log
        // Use the updated initialExcludeList
        // Call loadNextSlide without the exclude list
        setTimeout(loadNextSlide, 250); // loadNextSlide now just fetches DATA

        console.log("--- DEBUG: initializeOrRefreshFeed FINISHED --- "); // DEBUG
    }

    function clearFeed() {
        console.log("Clearing feed (Virtualization Version)...");
        // Stop observing elements in the pool
        if (observer) {
            slidePool.forEach(slide => observer.unobserve(slide));
        }
        // We don't remove the pooled elements, maybe just hide/reset them?
        // Or simply let initializeOrRefreshFeed handle clearing and rebuilding the pool.
        // For simplicity now, let initializeOrRefreshFeed handle clearing the container.
        // appContainer.innerHTML = ''; // Let initializer do this
        
        slidePool = []; // Clear the reference array
        activeSlideIndex = -1; // Reset active index (Now refers to DATA index)
        loadedVideoFilenames = []; // Reset loaded list (Still useful for exclude?) - MAYBE NOT NEEDED
        availableVideos = []; // <<< NEW: Clear the main data source
        videoStats = {}; // Reset stats cache
        allVideosLoaded = false;
        hasAttemptedInitialNextLoad = false; // Reset this flag too
        virtualScrollPosition = 0; // Reset virtual scroll tracker
        console.log("Feed data cleared.");
    }

    // --- Debounced Resize Handler --- <<< NEW
    const handleResize = () => {
        console.log("--- DEBUG: Handling resize event ---");
            updateTitleStyles();
        updateVisibleRange(); // <<< IMPORTANT: Recalculate slide positions
    }
    const debouncedResizeHandler = debounce(handleResize, 100); // Debounce resize events
    window.addEventListener('resize', debouncedResizeHandler);
    // --- End Resize Handler ---

    // --- Debounced Scroll Listener for Virtualization --- <<< NEW
    if (appContainer) {
         const debouncedScrollHandler = debounce(updateVisibleRange, 50); // Adjust delay (ms) as needed
         appContainer.addEventListener('scroll', debouncedScrollHandler);
         console.log("--- DEBUG: Attached debounced scroll listener to appContainer.");
         } else {
         console.error("Could not attach scroll listener: appContainer not found initially.");
     }

    // Wait for Firebase auth state to be ready before fully initializing
    // The onAuthStateChanged listener will call initializeOrRefreshFeed once the initial user state is known.
    // We don't need the direct call here anymore as onAuthStateChanged handles the initial call.
    // initialize(); // Remove this direct call

    // Attach listeners for login/logout buttons immediately
    loginButton.addEventListener('click', signInWithGoogle);

    console.log("Event listeners for login/logout attached. Waiting for Auth state...");

    // The actual feed initialization (fetching videos etc.) now happens
    // within the onAuthStateChanged callback after the user status (logged in or out) is determined.

    // --- Auth Dropdown Logic --- <<< NEW
    if (userPfpElement && authDropdown) {
        userPfpElement.addEventListener('click', (event) => {
            console.log("--- DEBUG: PFP clicked! ---"); // Log that the listener fired
            event.stopPropagation(); // Prevent potential body clicks
            if (authDropdown) { // Double-check dropdown exists here
                authDropdown.classList.toggle('visible');
                console.log("--- DEBUG: Toggled dropdown visibility. Has 'visible' class:", authDropdown.classList.contains('visible'));
        } else {
                console.error("--- DEBUG: authDropdown element is null inside click listener!");
            }
        });
    }

    if (dropdownLogoutButton) {
        dropdownLogoutButton.addEventListener('click', () => {
             console.log("Logout button clicked in dropdown.");
             signOutUser();
             if (authDropdown) authDropdown.classList.remove('visible'); // Hide dropdown after click
        });
    }

    // Optional: Hide dropdown when clicking outside
    document.addEventListener('click', (event) => {
        if (authDropdown && authDropdown.classList.contains('visible')) {
            // Check if the click was outside the dropdown AND outside the PFP
            if (!authDropdown.contains(event.target) && !userPfpElement?.contains(event.target)) {
                authDropdown.classList.remove('visible');
            }
        }
    });
    // --- End Auth Dropdown Logic ---
});
