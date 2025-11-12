// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore, doc, collection, addDoc, onSnapshot, updateDoc, deleteDoc, getDoc, setDoc } from "firebase/firestore";


// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDXUJ2ooY5S_pR2liDGe-afRZhNo0RI8Zs",
  authDomain: "latinfroggame.firebaseapp.com",
  databaseURL: "https://latinfroggame-default-rtdb.firebaseio.com",
  projectId: "latinfroggame",
  storageBucket: "latinfroggame.firebasestorage.app",
  messagingSenderId: "196302891263",
  appId: "1:196302891263:web:0b2fd634738f890580c4ca",
  measurementId: "G-S5H91BQYMB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);


const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};

let pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;
let roomId = null;
let isPresenter = false;
let unsubscribers = [];

// DOM elements
const joinView = document.getElementById('join-view');
const roomView = document.getElementById('room-view');
const joinForm = document.getElementById('join-form');
const roomIdInput = document.getElementById('room-id-input');
const roomIdDisplay = document.getElementById('room-id-display');
const remoteVideo = document.getElementById('remote-video');
const startShareBtn = document.getElementById('start-share-btn');
const stopShareBtn = document.getElementById('stop-share-btn');
const leaveBtn = document.getElementById('leave-btn');
const statusText = document.getElementById('status-text');
const statusMessageContainer = document.getElementById('status-message');

// Handle joining a room
joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const customRoomId = roomIdInput.value.trim();
    if (customRoomId) {
        joinRoom(customRoomId);
    }
});

// Auto-join if room ID is in URL hash
window.addEventListener('load', () => {
    if (window.location.hash) {
        const urlRoomId = window.location.hash.substring(1);
        if (urlRoomId) {
            roomIdInput.value = urlRoomId;
            joinRoom(urlRoomId);
        }
    }
});


async function joinRoom(id) {
    roomId = id;
    // Use hash to avoid cross-origin errors in sandboxed environments
    window.location.hash = id;
    
    joinView.classList.add('hidden');
    roomView.classList.remove('hidden');
    roomIdDisplay.textContent = id;
    
    // Clean up any previous listeners before joining a new room
    cleanup();

    const roomRef = doc(db, 'rooms', id);

    const unsubscribeRoom = onSnapshot(roomRef, async (snapshot) => {
        const roomData = snapshot.data();
        
        // If room is deleted (presenter left), reset state for viewers
        if (!snapshot.exists()) {
             if (!isPresenter) {
                console.log("Presenter left. Cleaning up viewer state.");
                handlePresenterLeft();
             }
             return;
        }

        // A presenter exists, and we are a viewer who hasn't connected yet
        if (roomData.offer && !isPresenter && !pc.remoteDescription) {
            console.log("Offer found. Setting up viewer connection.");
            statusText.textContent = "Presenter found. Connecting to stream...";
            await setupViewerConnection(roomRef, roomData);
        }

        // We are the presenter, and a viewer has provided an answer
        if (roomData.answer && isPresenter && !pc.remoteDescription) {
            console.log("Answer found. Finalizing presenter connection.");
            await pc.setRemoteDescription(new RTCSessionDescription(roomData.answer))
                .catch(e => console.error("Error setting remote description for presenter:", e));
        }
    });
    unsubscribers.push(unsubscribeRoom);

    // Check initial state of the room
    const initialSnapshot = await getDoc(roomRef);
    if (!initialSnapshot.exists() || !initialSnapshot.data().offer) {
        handlePresenterLeft(); // Set initial state for joining an empty room
    }
}

// Start sharing screen
startShareBtn.addEventListener('click', async () => {
    isPresenter = true;
    startShareBtn.disabled = true;

    try {
        // First, try to get video and audio. This can fail if the user
        // denies audio permission or the system doesn't support it.
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (err) {
        console.warn("Could not get display media with audio, trying without.", err);
        try {
            // Fallback to video only
            localStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        } catch (fallbackErr) {
            console.error("Error getting display media.", fallbackErr);
            alert("Could not start screen share. Please grant permission and try again.");
            isPresenter = false;
            startShareBtn.disabled = false;
            return;
        }
    }
    
    // When user stops sharing via browser UI
    localStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
    };
    
    resetPeerConnection();
    
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    const roomRef = doc(db, 'rooms', roomId);
    const offerCandidates = collection(roomRef, 'offerCandidates');
    const answerCandidates = collection(roomRef, 'answerCandidates');

    pc.onicecandidate = event => {
        if (event.candidate) {
            addDoc(offerCandidates, event.candidate.toJSON());
        }
    };
    
    const unsubAnswerCandidates = onSnapshot(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const candidate = new RTCIceCandidate(change.doc.data());
                pc.addIceCandidate(candidate).catch(e => console.error("Error adding ICE candidate for presenter:", e));
            }
        });
    });
    unsubscribers.push(unsubAnswerCandidates);

    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
    };
    
    // Set presenter info, this will also create the room doc if it doesn't exist
    await setDoc(roomRef, { offer, presenterId: 'presenter' }, { merge: true });

    statusText.textContent = "You are presenting. Waiting for a viewer to connect.";
    statusMessageContainer.classList.remove('hidden');
    stopShareBtn.classList.remove('hidden');
    startShareBtn.classList.add('hidden');
});

// Setup connection as a viewer
async function setupViewerConnection(roomRef, roomData) {
    resetPeerConnection();
    remoteStream = new MediaStream();
    
    pc.ontrack = (event) => {
        statusMessageContainer.classList.add('hidden'); // Hide status message once stream starts
        // Use event.track which is more reliable than event.streams[0]
        if (event.track) {
            remoteStream.addTrack(event.track);
        }
    };
    remoteVideo.srcObject = remoteStream;

    const offerCandidates = collection(roomRef, 'offerCandidates');
    const answerCandidates = collection(roomRef, 'answerCandidates');

    pc.onicecandidate = event => {
        if (event.candidate) {
            addDoc(answerCandidates, event.candidate.toJSON());
        }
    };
    
    if (roomData.offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(roomData.offer))
            .catch(e => console.error("Error setting remote description for viewer:", e));
        
        const answerDescription = await pc.createAnswer();
        await pc.setLocalDescription(answerDescription);

        const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
        };
        await updateDoc(roomRef, { answer });
        
        const unsubOfferCandidates = onSnapshot(offerCandidates, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    pc.addIceCandidate(candidate).catch(e => console.error("Error adding ICE candidate for viewer:", e));
                }
            });
        });
        unsubscribers.push(unsubOfferCandidates);
    }
}

// Stop sharing screen
async function stopScreenShare() {
    if (!isPresenter) return;
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    const roomRef = doc(db, 'rooms', roomId);
    // Delete the room doc to signal the end of the presentation for all viewers
    await deleteDoc(roomRef).catch(e => console.error("Error cleaning up room:", e));
    
    isPresenter = false;
    handlePresenterLeft(); // Also reset the presenter's UI and state
}

function handlePresenterLeft() {
    console.log("Resetting UI and connection state.");
    remoteVideo.srcObject = null;
    statusMessageContainer.classList.remove('hidden');
    statusText.textContent = 'Welcome! Waiting for a presenter.';
    startShareBtn.disabled = false;
    startShareBtn.classList.remove('hidden');
    stopShareBtn.classList.add('hidden');
    
    cleanup();
}

function resetPeerConnection() {
    if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.close();
    }
    pc = new RTCPeerConnection(servers);
}

function cleanup() {
    console.log(`Cleaning up ${unsubscribers.length} listeners.`);
    unsubscribers.forEach(unsubscribe => unsubscribe());
    unsubscribers = [];
    
    resetPeerConnection();
}

// Leave room
leaveBtn.addEventListener('click', async () => {
    if (isPresenter) {
        await stopScreenShare();
    }
    // Easiest way to reset state is to reload to the join page
    window.location.href = window.location.pathname;
});