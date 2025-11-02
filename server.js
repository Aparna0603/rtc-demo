// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

const PORT = process.env.PORT || 3000;

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));

io.on('connection', socket => {
  console.log('connect', socket.id);

  socket.on('join-room', ({ room, userName }) => {
    socket.join(room);
   
    const clients = Array.from(io.sockets.adapter.rooms.get(room) || []);
   
    socket.emit('joined-room', { you: socket.id, peers: clients.filter(id => id !== socket.id) });


    socket.to(room).emit('peer-joined', { id: socket.id, userName });
    console.log(`${socket.id} joined ${room}`);
  });


  socket.on('signal', ({ to, from, payload }) => {
    io.to(to).emit('signal', { from, payload });
  });

  // Room leave
  socket.on('leave-room', ({ room }) => {
    socket.leave(room);
    socket.to(room).emit('peer-left', { id: socket.id });
  });

  socket.on('disconnecting', () => {
    // notify all rooms this socket is in
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      socket.to(room).emit('peer-left', { id: socket.id });
    }
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
  });
});

server.listen(PORT, () => console.log(`Server running http://localhost:${PORT}`));
