import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import SimplePeer from "simple-peer";
import EventEmitter from "events";
import { Video, Users2, MicOff, CameraOff, Rocket, Send } from "lucide-react";

// Fix EventEmitter for SimplePeer
window.EventEmitter = EventEmitter;

// 🌐 Dynamic backend URL (works for both local + Render deployment)
const SIGNAL_SERVER =
  import.meta.env.MODE === "development"
    ? "http://localhost:3000"
    : "https://rtc-demo-rx87.onrender.com"; // your deployed backend URL

export default function Room() {
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("Aparna");
  const [joined, setJoined] = useState(false);
  const [chatLog, setChatLog] = useState([]);

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const peersRef = useRef({});
  const remoteVideosRef = useRef({});

  const ICE = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
  };

  // ✅ Cleanup resources on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current)
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      Object.values(peersRef.current).forEach(({ peer }) => peer.destroy?.());
      socketRef.current?.disconnect();
    };
  }, []);

  // 🎥 Setup local video when component renders with stream
  useEffect(() => {
    const setupLocalVideo = async () => {
      if (joined && localStreamRef.current && localVideoRef.current && !localVideoRef.current.srcObject) {
        console.log("🔄 Setting up local video after component render...");
        localVideoRef.current.srcObject = localStreamRef.current;

        try {
          await localVideoRef.current.play();
          console.log("▶️ Local video now playing successfully");
        } catch (playErr) {
          console.error("❌ Video play error:", playErr);
          localVideoRef.current.muted = true;
          try {
            await localVideoRef.current.play();
            console.log("▶️ Local video playing (muted)");
          } catch (err) {
            console.error("❌ Failed to play even muted:", err);
          }
        }

        // Debug after successful setup
        setTimeout(debugVideoElement, 500);
      }
    };

    setupLocalVideo();
  }, [joined]); // Run when 'joined' state changes

  const pushChat = (msg) => setChatLog((prev) => [...prev, msg]);

  // 🎥 Request camera/mic access
  async function startLocalStream() {
    try {
      console.log("🎥 Requesting camera/mic access...");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      console.log("✅ Media stream obtained:", stream);
      console.log("📹 Video tracks:", stream.getVideoTracks().length);
      console.log("🎵 Audio tracks:", stream.getAudioTracks().length);

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        console.log("🎬 Setting video element srcObject...");
        localVideoRef.current.srcObject = stream;

        try {
          await localVideoRef.current.play();
          console.log("▶️ Local video playing successfully");
        } catch (playErr) {
          console.error("❌ Video play error:", playErr);
          // Try to play again after user interaction
          localVideoRef.current.muted = true;
          await localVideoRef.current.play();
        }
      } else {
        console.log("⏳ Video element not ready yet - will set up after component renders");
      }

      return stream;
    } catch (err) {
      console.error("❌ Media access error:", err);
      console.error("Error name:", err.name);
      console.error("Error message:", err.message);

      let userMessage = "Camera/microphone access failed: ";
      switch (err.name) {
        case 'NotAllowedError':
          userMessage += "Permission denied. Please allow camera access and reload.";
          break;
        case 'NotFoundError':
          userMessage += "No camera/microphone found.";
          break;
        case 'NotReadableError':
          userMessage += "Camera is already in use by another application.";
          break;
        case 'OverconstrainedError':
          userMessage += "Camera doesn't support requested settings.";
          break;
        default:
          userMessage += err.message;
      }

      alert(userMessage);
      throw err;
    }
  }

  // 🔍 Debug video element state
  const debugVideoElement = () => {
    const video = localVideoRef.current;
    if (!video) {
      console.log("❌ localVideoRef is null");
      return;
    }

    console.log("🔍 Video Element Debug:");
    console.log("- Video element exists:", !!video);
    console.log("- srcObject:", video.srcObject);
    console.log("- Video width:", video.videoWidth);
    console.log("- Video height:", video.videoHeight);
    console.log("- Ready state:", video.readyState);
    console.log("- Paused:", video.paused);
    console.log("- Muted:", video.muted);
    console.log("- Volume:", video.volume);
    console.log("- Current time:", video.currentTime);

    if (video.srcObject) {
      const stream = video.srcObject;
      console.log("- Stream active:", stream.active);
      console.log("- Video tracks:", stream.getVideoTracks().map(t => ({
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState
      })));
    }
  };

  // Add debug to joinRoom after video setup
  const originalJoinRoom = async () => {
    if (!roomId.trim()) return alert("Enter room ID");
    const stream = await startLocalStream();

    // Debug after getting stream
    setTimeout(debugVideoElement, 1000);

    socketRef.current = io(SIGNAL_SERVER, { transports: ["websocket"] });

    socketRef.current.on("connect", () => {
      pushChat(`🟢 Connected as ${name}`);
      socketRef.current.emit("join-room", { room: roomId, userName: name });
    });

    socketRef.current.on("joined-room", () => {
      pushChat(`✅ Joined room: ${roomId}`);
      setJoined(true);
      // Debug after joining
      setTimeout(debugVideoElement, 2000);
    });

    socketRef.current.on("peer-joined", ({ id }) => {
      pushChat(`👤 Peer joined: ${id}`);
      createPeer(id, true);
    });

    socketRef.current.on("signal", ({ from, payload }) => {
      handleIncomingSignal(from, payload);
    });

    socketRef.current.on("peer-left", ({ id }) => {
      pushChat(`❌ Peer left: ${id}`);
      if (peersRef.current[id]) peersRef.current[id].peer.destroy?.();
    });
  };

  // 🎬 Peer creation logic
  const createPeer = (peerId, initiator = false) => {
    const peer = new SimplePeer({
      initiator,
      trickle: true,
      config: ICE,
      stream: localStreamRef.current,
    });

    peer.on("signal", (signalData) => {
      socketRef.current.emit("signal", {
        to: peerId,
        from: socketRef.current.id,
        payload: signalData,
      });
    });

    peer.on("stream", (remoteStream) => {
      let vid = remoteVideosRef.current[peerId];
      if (!vid) {
        vid = document.createElement("video");
        vid.autoplay = true;
        vid.playsInline = true;
        vid.className =
          "w-56 h-40 rounded-xl shadow-lg ring-2 ring-purple-400/60 hover:scale-105 transition-transform duration-200";
        document.getElementById("remote-videos").appendChild(vid);
        remoteVideosRef.current[peerId] = vid;
      }
      vid.srcObject = remoteStream;
    });

    peer.on("data", (data) => {
      const msg = new TextDecoder().decode(data);
      pushChat(`💬 Peer: ${msg}`);
    });

    peer.on("close", () => {
      if (remoteVideosRef.current[peerId]) {
        remoteVideosRef.current[peerId].remove();
        delete remoteVideosRef.current[peerId];
      }
      delete peersRef.current[peerId];
    });

    peersRef.current[peerId] = { peer };
    return peer;
  };

  const handleIncomingSignal = (fromId, payload) => {
    if (!peersRef.current[fromId]) createPeer(fromId, false);
    peersRef.current[fromId].peer.signal(payload);
  };

  // 🚀 Join room logic (now with debugging)
  const joinRoom = originalJoinRoom;

  const sendChat = () => {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    pushChat(`💬 ${name}: ${text}`);
    Object.values(peersRef.current).forEach(({ peer }) => {
      if (peer && peer.connected) peer.send(text);
    });
    input.value = "";
  };

  const toggleAudio = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current
      .getAudioTracks()
      .forEach((t) => (t.enabled = !t.enabled));
  };

  const toggleVideo = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current
      .getVideoTracks()
      .forEach((t) => (t.enabled = !t.enabled));
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 p-6 relative overflow-hidden">
      <div className="absolute -top-20 -left-20 w-72 h-72 bg-purple-300/40 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-pink-300/40 rounded-full blur-3xl animate-pulse" />

      <div className="backdrop-blur-lg bg-white/70 border border-white/40 shadow-2xl rounded-3xl w-full max-w-5xl p-8 relative z-10">
        <h2 className="text-3xl font-extrabold text-center mb-6 text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-pink-600 animate-fade-in">
          <Video className="inline w-7 h-7 text-purple-600 mr-2" />
          Aparna’s WebRTC Room
        </h2>

        {!joined ? (
          <div className="max-w-md mx-auto text-center animate-fade-in-up">
            <input
              placeholder="Enter Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="border p-3 w-full mb-4 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-400 outline-none"
            />
            <input
              placeholder="Your Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border p-3 w-full mb-4 rounded-xl shadow-sm focus:ring-2 focus:ring-pink-400 outline-none"
            />
            <button
              onClick={joinRoom}
              className="flex justify-center items-center gap-2 bg-gradient-to-r from-indigo-500 to-pink-500 text-white w-full py-3 rounded-xl font-semibold shadow-lg hover:opacity-90 transition"
            >
              <Rocket className="w-4 h-4" />
              Join Room
            </button>
            <p className="text-sm text-gray-600 mt-4">
              Open another tab & join the same Room ID to test{" "}
              <Users2 className="inline w-4 h-4 text-purple-500" />
            </p>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-5">
              <div className="flex gap-3">
                <button
                  onClick={toggleAudio}
                  className="bg-yellow-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-yellow-600 shadow-md transition"
                >
                  <MicOff className="w-4 h-4" /> Mute
                </button>
                <button
                  onClick={toggleVideo}
                  className="bg-red-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-red-600 shadow-md transition"
                >
                  <CameraOff className="w-4 h-4" /> Video
                </button>
              </div>
              <div className="text-sm font-semibold text-gray-700">
                Room: <span className="text-indigo-600">{roomId}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white/80 p-3 rounded-xl shadow-md border border-gray-200">
                <h4 className="font-semibold mb-2 text-gray-700">You</h4>
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-56 rounded-xl bg-black ring-2 ring-indigo-400/70 shadow-lg"
                />
              </div>

              <div className="col-span-2 bg-white/80 p-3 rounded-xl shadow-md border border-gray-200">
                <h4 className="font-semibold mb-2 text-gray-700">Peers</h4>
                <div
                  id="remote-videos"
                  className="flex flex-wrap gap-3 justify-center"
                ></div>
              </div>
            </div>

            <div className="mt-6 bg-white/80 rounded-xl shadow-md border border-gray-200 p-4">
              <h4 className="font-semibold mb-3 text-gray-700">💬 Chat</h4>
              <div className="border rounded-lg p-3 h-48 overflow-auto bg-gray-50 mb-2 text-sm scroll-smooth">
                {chatLog.map((m, i) => (
                  <div key={i} className="mb-1">
                    {m}
                  </div>
                ))}
              </div>
              <div className="flex">
                <input
                  id="chat-input"
                  placeholder="Type a message..."
                  className="flex-1 border p-2 rounded-l-lg focus:ring-2 focus:ring-indigo-400 outline-none"
                />
                <button
                  onClick={sendChat}
                  className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-pink-500 text-white px-4 py-2 rounded-r-lg font-semibold hover:opacity-90 transition"
                >
                  <Send className="w-4 h-4" /> Send
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
