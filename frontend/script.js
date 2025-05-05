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

    // --- Authentication Functions ---
    function signInWithGoogle() {
        auth.signInWithPopup(googleProvider)
            .then((result) => {
                console.log("Signed in successfully:", result.user);
                // Token will be retrieved by onAuthStateChanged
            }).catch((error) => {
                console.error("Google Sign-In Error:", error);
                // Handle Errors here.
                const errorCode = error.code;
                const errorMessage = error.message;
                const email = error.email;
                const credential = error.credential;
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
            console.log("Auth State Changed: User logged in", currentUser.uid);
            userEmailSpan.textContent = currentUser.email;
            userInfoDiv.style.display = 'flex'; // Show user info/logout
            loginButton.style.display = 'none'; // Hide login

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
    logoutButton.addEventListener('click', signOutUser);

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

    // --- Core Functions ---
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
        
        if (slideIndex !== activeSlideIndex || !player || !scrub || !isFinite(player.duration) || player.duration === 0) {
             return; 
         }
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
        
        // If it's not the active player, scroll to it. Observer will handle play.
        if (index !== activeSlideIndex) {
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
            alert("Please log in to like videos.");
            // Optionally, trigger the login flow directly:
            // signInWithGoogle();
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
            threshold: 0.6
        };

        // Define observer in the outer scope if not already
        observer = new IntersectionObserver((entries) => {
            console.log(`--- DEBUG: Intersection Observer Callback Fired (${entries.length} entries) ---`); // DEBUG
            let bestEntry = null;
            entries.forEach(entry => {
                 console.log(`--- DEBUG: Observer Entry - Target: ${entry.target.dataset.slideIndex}, Intersecting: ${entry.isIntersecting}, Ratio: ${entry.intersectionRatio.toFixed(2)}`); // DEBUG
                if (entry.isIntersecting && entry.intersectionRatio >= options.threshold) { // Check threshold here
                    if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
                        bestEntry = entry;
                    }
                }
            });

            if (bestEntry) {
                const newActiveIndex = parseInt(bestEntry.target.dataset.slideIndex, 10);
                console.log(`--- DEBUG: Best intersecting entry is Slide ${newActiveIndex + 1}`); // DEBUG

                if (newActiveIndex !== activeSlideIndex) {
                     console.log(`--- DEBUG: Intersection Change - New active slide: ${newActiveIndex + 1}`); // DEBUG
                    
                     // --- Update URL Hash --- 
                     const activePlayerForURL = bestEntry.target.querySelector('.video-player');
                     const filenameForURL = activePlayerForURL?.currentSrc?.split('/').pop();
                     if (filenameForURL) {
                         // Use pushState to change the hash without reloading
                         // Using just the filename as the hash for simplicity
                         history.pushState({ videoFilename: filenameForURL }, "", `#${filenameForURL}`);
                         console.log(`--- DEBUG: Updated URL hash to #${filenameForURL}`);
                     } else {
                         // Optionally clear hash or go back to root if filename not found
                         // history.pushState({}, "", window.location.pathname + window.location.search); 
                     }
                     // --- End URL Update ---
                    
                    // Pause and Reset previously active video
                    if (activeSlideIndex !== -1) { 
                        // Find the *previous* slide element based on the index
                        const oldSlide = appContainer.querySelector(`[data-slide-index="${activeSlideIndex}"]`);
                        if (oldSlide) {
                            const oldPlayer = oldSlide.querySelector('.video-player');
                            const oldScrub = oldSlide.querySelector('.scrub-bar');
                            if (oldPlayer) {
                                oldPlayer.pause();
                                oldPlayer.currentTime = 0; 
                                console.log(`Paused and Reset player in slide ${activeSlideIndex + 1}`);
                            }
                            if (oldScrub) {
                                resetScrubBar(oldScrub); 
                            }
                            // Hide play indicator of old slide
                            const oldPlayIndicator = oldSlide.querySelector('.play-indicator');
                            if (oldPlayIndicator) {
                                oldPlayIndicator.classList.remove('visible');
                            }
                        } else {
                             console.warn(`Could not find previous slide element for index ${activeSlideIndex}`);
                        }
                    }
                    
                    activeSlideIndex = newActiveIndex;

                    // Play the new active video 
                    const activePlayer = bestEntry.target.querySelector('.video-player');
                    if (activePlayer) {
                         console.log(`--- DEBUG: Observer attempting to play new active slide ${activeSlideIndex + 1}`); // DEBUG
                         activePlayer.muted = userMutedPreference; 
                         attemptPlay(activePlayer);
                     }

                    // Check if the *last* slide is now intersecting - if so, try loading next
                     const isLastSlide = bestEntry.target === appContainer.lastElementChild;
                     console.log(`--- DEBUG: Observer - Is last slide intersecting? ${isLastSlide}. All videos loaded flag: ${allVideosLoaded}`); // DEBUG
                     if (isLastSlide && !allVideosLoaded) {
                         console.log("Last slide intersecting, attempting to load next.");
                         loadNextSlide();
                     }
                    
                    // Ensure play indicator is hidden when playing
                    const currentPlayIndicator = bestEntry.target.querySelector('.play-indicator');
                    if(currentPlayIndicator) {
                        currentPlayIndicator.classList.remove('visible');
                    }
                } else if (newActiveIndex === activeSlideIndex) {
                    // Re-focus check - Ensure it's playing
                    const currentPlayer = bestEntry.target.querySelector('.video-player');
                    if(currentPlayer && currentPlayer.paused){
                         console.log(`--- DEBUG: Observer - Re-focus on active slide ${activeSlideIndex + 1}, ensuring play.`); // DEBUG
                         attemptPlay(currentPlayer);
                    }
                }
            } else {
                 console.log("--- DEBUG: Observer - No entry met threshold. Current active index:", activeSlideIndex); // DEBUG
                  // Consider pausing if needed, logic currently disabled
            }
        }, options);
        console.log("--- DEBUG: Intersection Observer setup complete. ---"); // DEBUG
        // Initial observation is handled by initializeOrRefreshFeed
    }

    // Fetch the NEXT video filename AND title from backend
    async function fetchNextVideoData(excludeList = []) { // Accept exclude list
        if (isFetching || allVideosLoaded) {
            console.log(`fetchNextVideoData: Skipping fetch (isFetching: ${isFetching}, allVideosLoaded: ${allVideosLoaded})`);
            return null;
        }
        console.log("Attempting to fetch next video data, excluding:", excludeList);
        isFetching = true;
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/next_video`, {
                method: 'POST',
                body: JSON.stringify({ exclude: excludeList }) // Send exclude list
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

    // Create a new slide element, populate it, and add listeners
    function createAndAppendSlide(videoData, index) {
        const { filename, title, creator } = videoData; // Destructure needed data
        console.log(`--- DEBUG: createAndAppendSlide START for index ${index}, filename ${filename}`); // DEBUG

        // --- Create Elements Programmatically ---
        const newSlide = document.createElement('div');
        newSlide.classList.add('video-slide');
        newSlide.dataset.slideIndex = index;

        const videoWrapper = document.createElement('div');
        videoWrapper.classList.add('video-wrapper');

        const player = document.createElement('video');
        player.classList.add('video-player');
        player.setAttribute('playsinline', ''); // Important for mobile
        player.setAttribute('webkit-playsinline', ''); // iOS Safari
        player.loop = true; // Standard behavior for shorts
        player.preload = 'metadata'; // Changed back from 'auto' to 'metadata'
        player.src = `${API_BASE_URL}/videos/${filename}`;

        const videoOverlay = document.createElement('div');
        videoOverlay.classList.add('video-overlay');

        const videoInfo = document.createElement('div');
        videoInfo.classList.add('video-info');

        const pfpPlaceholder = document.createElement('div');
        pfpPlaceholder.classList.add('pfp-placeholder'); // You might want to add an <img> later

        const textInfo = document.createElement('div');
        textInfo.classList.add('text-info');

        const titleElement = document.createElement('h3');
        titleElement.classList.add('video-title');
        titleElement.textContent = title || "Unknown Title";

        const creatorElement = document.createElement('p');
        creatorElement.classList.add('video-creator');
        creatorElement.textContent = creator || "@unknown_creator";

        textInfo.appendChild(titleElement);
        textInfo.appendChild(creatorElement);
        videoInfo.appendChild(pfpPlaceholder);
        videoInfo.appendChild(textInfo);

        const muteButton = document.createElement('button');
        muteButton.classList.add('mute-button');
        muteButton.innerHTML = '<i class="fas fa-volume-mute"></i>'; // Default icon

        const likeButton = document.createElement('button');
        likeButton.classList.add('like-button');
        const likeIcon = document.createElement('i');
        likeIcon.classList.add('far', 'fa-heart'); // Default icon
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

        console.log(`--- DEBUG: createAndAppendSlide - Elements created for index ${index}`); // DEBUG

        // --- Set Initial Like Button State from videoStats ---
        const stats = videoStats[filename]; // Get pre-fetched stats
        if (stats) {
            likeCountElement.textContent = formatLikeCount(stats.like_count);
            const isLiked = stats.is_liked_by_user;
            likeButton.classList.toggle('liked', isLiked);
            likeIcon.classList.toggle('fas', isLiked); // Solid heart if liked
            likeIcon.classList.toggle('far', !isLiked); // Outline heart if not liked
             console.log(`createAndAppendSlide: Set initial like state - Count: ${stats.like_count}, Liked: ${isLiked}`);
        } else {
             likeCountElement.textContent = '0'; // Default if stats somehow missing
             console.warn(`createAndAppendSlide: videoStats missing for ${filename}. Defaulting like count.`);
        }
        // --- End Initial Like State ---

        player.load();
        player.muted = userMutedPreference;
        console.log(`--- DEBUG: createAndAppendSlide - Player loaded, muted=${player.muted} for index ${index}`); // DEBUG

        attachSingleSlideListeners(newSlide, index); // Includes its own DEBUG log

        console.log(`--- DEBUG: createAndAppendSlide - Appending slide index ${index} to container.`); // DEBUG
        appContainer.appendChild(newSlide);

        if (observer) { // Check if observer exists before observing
            console.log(`--- DEBUG: createAndAppendSlide - Observer exists. Observing new slide index ${index}`); // DEBUG
        observer.observe(newSlide);
        } else {
            console.warn(`--- DEBUG: createAndAppendSlide - Observer NOT YET INITIALIZED when trying to observe slide index ${index}`); // DEBUG
        }

        if (!loadedVideoFilenames.includes(filename)) {
        loadedVideoFilenames.push(filename);
        }
        updateSpecificMuteButton(muteButton, userMutedPreference);
        // Call resize functions AFTER appending to ensure dimensions are calculated correctly
        // updateMuteButtonSize(); // <<< COMMENT OUT
        // updateLikeButtonSize(); // <<< COMMENT OUT
        // updatePlayIndicatorSize(); // <<< COMMENT OUT
        updateTitleStyles(); // Keep this one for title/creator/pfp
        console.log(`--- DEBUG: createAndAppendSlide FINISHED for index ${index}`); // DEBUG

        return newSlide;
    }

    // Attempt to load the next video and create a slide for it
    async function loadNextSlide(excludeFromFirstFetch = []) {
        console.log(`loadNextSlide called. allVideosLoaded: ${allVideosLoaded}, isFetching: ${isFetching}, excludeFromFirstFetch:`, excludeFromFirstFetch);
        if (allVideosLoaded || isFetching) {
            console.log("--- DEBUG: loadNextSlide - Skipping due to allVideosLoaded or isFetching."); // DEBUG
            return;
        }

        // Combine permanent loaded list with temporary exclusion for this call
        const currentExcludeList = [...loadedVideoFilenames, ...excludeFromFirstFetch];
        console.log("--- DEBUG: loadNextSlide - Combined exclude list:", currentExcludeList); // DEBUG
        
        const nextVideoData = await fetchNextVideoData(currentExcludeList); // Pass combined list to fetcher
        console.log("--- DEBUG: loadNextSlide - Result from fetchNextVideoData:", nextVideoData); // DEBUG
        if (nextVideoData && nextVideoData.filename) { 
            const nextSlideIndex = appContainer.children.length;
            console.log(`loadNextSlide: Got data ${JSON.stringify(nextVideoData)}, proceeding to create slide index ${nextSlideIndex}`);
            createAndAppendSlide(nextVideoData, nextSlideIndex); 
        } else {
            console.log("loadNextSlide: No next video data received, not creating slide.");
        }
    }

    // --- NEW: Update Play Indicator Size ---
    function updatePlayIndicatorSize() {
        console.log("Updating ALL play indicator sizes.");
        if (!appContainer) {
            console.error("updatePlayIndicatorSize: appContainer not found!");
            return;
        }
        const containerWidth = appContainer.offsetWidth;
        if (containerWidth === 0) {
            console.warn("updatePlayIndicatorSize: Container width is 0, skipping resize.");
            return;
        }
        // Base size on mute button size
        const muteButtonSize = Math.max(30, containerWidth / 10); 
        const indicatorSize = muteButtonSize * 1.8; // Approx 2x diameter, adjust as needed
        const iconFontSize = indicatorSize * 0.4; // Icon size relative to indicator
        console.log(`Calculated Play Indicator Size: ${indicatorSize}px, Icon Font Size: ${iconFontSize}px`);

        document.querySelectorAll('.play-indicator').forEach(indicator => {
            if (!indicator) return;
            indicator.style.width = `${indicatorSize}px`;
            indicator.style.height = `${indicatorSize}px`;
            const icon = indicator.querySelector('i');
            if (icon) {
                icon.style.fontSize = `${iconFontSize}px`;
            }
        });
    }

    // --- Initialization Function (Refactored) ---
    async function initializeOrRefreshFeed() {
        console.log("--- DEBUG: initializeOrRefreshFeed START --- "); // DEBUG
        isInitialized = false; 
        clearFeed(); 

        let requestedFilename = null;
        let videoDataToLoadFirst = null;
        let initialExcludeList = [];

        // --- Check for initial video hash --- 
        if (window.location.hash && window.location.hash.length > 1) {
            requestedFilename = window.location.hash.substring(1);
            console.log(`--- DEBUG: Found requested filename in URL hash: ${requestedFilename}`);
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
            }
        }
        // --- End initial batch fetch --- 

        if (!videoDataToLoadFirst) {
             console.error("Initialization failed: Could not determine a valid first video to load.");
             isInitialized = true;
             return;
        }
         console.log(`--- DEBUG: initializeOrRefreshFeed - Determined first video: ${videoDataToLoadFirst.filename}`); // DEBUG
        
        // --- Load the determined first slide --- 
        const firstSlideElement = createAndAppendSlide(videoDataToLoadFirst, 0); 
        
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
                 console.log(`--- DEBUG: initializeOrRefreshFeed - Observer created. Observing first slide element.`); // DEBUG
                 observer.observe(firstSlideElement);
         } else {
                 console.error("--- DEBUG: initializeOrRefreshFeed - setupIntersectionObserver failed to create observer!"); // DEBUG
             }
        } else {
             console.log("--- DEBUG: initializeOrRefreshFeed - Observer already exists, ensuring it observes the new first slide.");
             observer.observe(firstSlideElement);
        }
        // --- End Observer Setup ---
        
        isInitialized = true;
        console.log("--- DEBUG: initializeOrRefreshFeed - Initialization state set to true."); // DEBUG

        // --- Load subsequent videos --- 
        console.log("--- DEBUG: Scheduling initial loadNextSlide call.");
        // Use the updated initialExcludeList
        setTimeout(() => loadNextSlide(initialExcludeList), 250); 

        console.log("--- DEBUG: initializeOrRefreshFeed FINISHED --- "); // DEBUG
    }

    function clearFeed() {
        console.log("Clearing existing video slides...");
        // Keep the template slide if it exists and is needed for cloning
        // Or assume the first slide fetched will become the new template
        const slides = appContainer.querySelectorAll('.video-slide');
        slides.forEach((slide, index) => {
             // A simple approach: Remove all slides.
             // The first slide will be re-created by setupInitialSlide.
             // Ensure observer stops watching them first!
             if (observer) observer.unobserve(slide);
             slide.remove();
        });
        activeSlideIndex = -1; // Reset active index
        loadedVideoFilenames = []; // Reset loaded list
        // videoStats = {}; // Reset stats cache (already done in fetchAvailableVideos)
        allVideosLoaded = false;
        hasAttemptedInitialNextLoad = false;
        console.log("Feed cleared.");
    }

    // Ensure resize listener updates both
    window.addEventListener('resize', () => {
        // updateMuteButtonSize(); // <<< COMMENT OUT
        // updateLikeButtonSize(); // <<< COMMENT OUT
        // updatePlayIndicatorSize(); // <<< COMMENT OUT
        updateTitleStyles(); // Keep this one
    });

    // --- Hash Change Listener --- 
    async function handleHashChange() { // <<< Make async
        console.log("--- DEBUG: Hash changed detected ---");
        if (!isInitialized) {
             console.log("--- DEBUG: Skipping hash change handling, not initialized yet.");
             return; 
        }
        
        const newFilename = window.location.hash.substring(1);
        if (!newFilename) {
            console.log("--- DEBUG: Hash cleared or empty. Potential: Reload to default?");
            // window.location.reload(); // Optionally reload if hash is removed
            return; 
        }

        console.log(`--- DEBUG: New hash filename: ${newFilename}`);

        // Check if this video slide is already in the DOM
        const existingSlide = Array.from(appContainer.querySelectorAll('.video-slide')).find(slide => {
            const player = slide.querySelector('.video-player');
            return player?.currentSrc?.endsWith('/' + newFilename);
        });

        if (existingSlide) {
            // If slide exists, scroll to it and ensure it's the active one
            console.log(`--- DEBUG: Hash target slide (${newFilename}) found in DOM. Scrolling...`);
            existingSlide.scrollIntoView({ behavior: 'smooth' });
            // We might need to manually trigger observer logic or wait for scroll
             // For now, just scroll and let observer catch up.
        } else {
            // If slide doesn't exist, fetch its details and replace the feed
            console.log(`--- DEBUG: Hash target slide (${newFilename}) not found in DOM. Fetching details...`);
            try {
                const response = await fetchWithAuth(`${API_BASE_URL}/video_details/${newFilename}`);
                if (!response.ok) {
                    if (response.status === 404) {
                        alert(`Video not found: ${newFilename}`);
                        console.error(`Video details fetch failed (404): ${newFilename}`);
                        history.back(); // Go back if video doesn't exist
                    } else {
                         throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return; // Stop if fetch failed
                }
                const videoData = await response.json();
                
                if (videoData && videoData.filename) {
                    console.log(`--- DEBUG: Fetched details for ${newFilename}. Clearing feed and loading.`);
                    clearFeed(); // Clear existing slides
                    // Update videoStats cache
                    videoStats[videoData.filename] = { 
                        like_count: videoData.like_count,
                        is_liked_by_user: videoData.is_liked_by_user
                    };
                    const newSlide = createAndAppendSlide(videoData, 0); // Create the specific slide as index 0
                    if (newSlide) {
                        // Ensure observer watches it
                        if (!observer) { setupIntersectionObserver(); } 
                        if (observer) { observer.observe(newSlide); } 
                        // Immediately set it as active?
                        activeSlideIndex = 0; // Manually set as active
                        // Trigger loading of the *next* video after this one
                        setTimeout(() => loadNextSlide([newFilename]), 250); 
                    } else {
                         console.error("--- DEBUG: Failed to create slide for fetched video details.");
                         window.location.reload(); // Fallback to reload if creation fails?
                    }
                } else {
                    console.error("--- DEBUG: Invalid data received from video_details endpoint.");
                    history.back(); // Go back if data invalid
                }
            } catch (error) {
                console.error("--- DEBUG: Error fetching video details for hash change:", error);
                alert("Failed to load the requested video.");
                history.back(); // Go back on error
            }
        }
    }
    window.addEventListener('hashchange', handleHashChange);
    // --- End Hash Change Listener ---

    // Wait for Firebase auth state to be ready before fully initializing
    // The onAuthStateChanged listener will call initializeOrRefreshFeed once the initial user state is known.
    // We don't need the direct call here anymore as onAuthStateChanged handles the initial call.
    // initialize(); // Remove this direct call

    // Attach listeners for login/logout buttons immediately
    loginButton.addEventListener('click', signInWithGoogle);
    logoutButton.addEventListener('click', signOutUser);

    console.log("Event listeners for login/logout attached. Waiting for Auth state...");

    // The actual feed initialization (fetching videos etc.) now happens
    // within the onAuthStateChanged callback after the user status (logged in or out) is determined.
});
