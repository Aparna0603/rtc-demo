// client.js
const socket = io(); // same origin
const localVideo = document.getElementById('localVideo');
const videosDiv = document.getElementById('videos');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const chatDiv = document.getElementById('chat');
const chatInput = document.getElementById('chatInput');
const sendChat = document.getElementById('sendChat');

let localStream = null;
const pcs = {}; // map peerId -> RTCPeerConnection
const dataChannels = {}; // peerId -> dataChannel
let roomName = null;
let myId = null;
let audioEnabled = true;
let videoEnabled = true;

/* ICE servers (add TURN config here later) */
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
    // add TURN entry here: { urls: 'turn:TURN_IP:3478', username: 'user', credential: 'pass' }
  ]
};

async function getLocalStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localVideo.srcObject = localStream;
  }
  return localStream;
}

function logChat(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  chatDiv.appendChild(el);
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

// create a new peer connection to targetPeer
function createPeerConnection(targetPeer) {
  const pc = new RTCPeerConnection(ICE_SERVERS);

  // add local tracks
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  // on remote track
  pc.ontrack = (evt) => {
    // create or update video element
    let v = document.getElementById('video-' + targetPeer);
    if (!v) {
      v = document.createElement('video');
      v.id = 'video-' + targetPeer;
      v.autoplay = true;
      v.playsInline = true;
      videosDiv.appendChild(v);
    }
    v.srcObject = evt.streams[0];
  };

  // ICE candidates -> send to other peer
  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      socket.emit('signal', { to: targetPeer, from: myId, payload: { type: 'ice', candidate: evt.candidate } });
    }
  };

  // create data channel for chat/controls (if we are the caller)
  const dc = pc.createDataChannel('chat');
  dc.onopen = () => console.log('datachannel open', targetPeer);
  dc.onmessage = (ev) => {
    logChat(`[${targetPeer}] ${ev.data}`);
  };
  dataChannels[targetPeer] = dc;

  // handle incoming datachannel (for the answering peer)
  pc.ondatachannel = (evt) => {
    const incoming = evt.channel;
    incoming.onmessage = (ev) => {
      logChat(`[${targetPeer}] ${ev.data}`);
    };
    dataChannels[targetPeer] = incoming;
  };

  pcs[targetPeer] = pc;
  return pc;
}

// Caller creates offer to each existing peer
async function callPeer(peerId) {
  const pc = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { to: peerId, from: myId, payload: { type: 'offer', sdp: offer } });
}

// When answering: set remote desc and send answer
async function handleOffer(from, sdp) {
  const pc = createPeerConnection(from);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('signal', { to: from, from: myId, payload: { type: 'answer', sdp: answer } });
}

async function handleAnswer(from, sdp) {
  const pc = pcs[from];
  if (!pc) {
    console.warn('No pc for', from);
    return;
  }
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleRemoteIce(from, candidate) {
  const pc = pcs[from];
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.error('addIceCandidate error', e);
  }
}

// socket handlers
socket.on('connect', () => console.log('socket connected', socket.id));
socket.on('joined-room', async ({ you, peers }) => {
  myId = you;
  logChat(`You joined as ${you}. Peers in room: ${peers.join(', ')}`);
  // create offers to all existing peers
  await getLocalStream();
  for (const peer of peers) {
    await callPeer(peer);
  }
});

socket.on('peer-joined', async ({ id }) => {
  logChat(`peer joined: ${id}`);
  // when someone joins after you, create offer to them
  await getLocalStream();
  await callPeer(id);
});

socket.on('peer-left', ({ id }) => {
  logChat(`peer left: ${id}`);
  if (pcs[id]) {
    pcs[id].close();
    delete pcs[id];
  }
  const el = document.getElementById('video-' + id);
  if (el) el.remove();
  if (dataChannels[id]) delete dataChannels[id];
});

socket.on('signal', async ({ from, payload }) => {
  if (payload.type === 'offer') {
    await handleOffer(from, payload.sdp);
  } else if (payload.type === 'answer') {
    await handleAnswer(from, payload.sdp);
  } else if (payload.type === 'ice') {
    await handleRemoteIce(from, payload.candidate);
  } else {
    console.warn('unknown payload', payload);
  }
});

// UI events
joinBtn.onclick = async () => {
  roomName = document.getElementById('roomInput').value || 'default-room';
  const name = document.getElementById('nameInput').value || 'Anon';
  await getLocalStream();
  socket.emit('join-room', { room: roomName, userName: name});
};

leaveBtn.onclick = () => {
  if (!roomName) return;
  socket.emit('leave-room', { room: roomName });
  // close all pcs and clear UI
  for (const id of Object.keys(pcs)) {
    pcs[id].close();
    const el = document.getElementById('video-' + id);
    if (el) el.remove();
  }
  Object.keys(pcs).forEach(k => delete pcs[k]);
  roomName = null;
};

muteBtn.onclick = () => {
  if (!localStream) return;
  audioEnabled = !audioEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
  muteBtn.textContent = audioEnabled ? 'Mute' : 'Unmute';
};

videoBtn.onclick = () => {
  if (!localStream) return;
  videoEnabled = !videoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
  videoBtn.textContent = videoEnabled ? 'Stop Video' : 'Start Video';
};

sendChat.onclick = () => {
  const text = chatInput.value.trim();
  if (!text) return;
  logChat(`[me] ${text}`);
  // send via data channels to each peer (peer-to-peer)
  for (const dc of Object.values(dataChannels)) {
    if (dc && dc.readyState === 'open') dc.send(text);
  }
  // optionally also send via server to new peers who don't have dc yet
  chatInput.value = '';
};
