import express, { Express, Request, Response } from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import { v4 as uuid } from 'uuid';
import { AddressInfo } from 'net';

const app: Express = express();

// Initialize a simple http server
const server = http.createServer(app);

// Initialize the WebSocket server instance
const wss = new WebSocket.Server({ server });

// Keep track of connections by their ID
const connections = new Map<string, WebSocket>();

// Define a session object
interface Session {
  name: string;
  editors: string[];
  readers: string[];
  sessionKey: string;
}

interface SessionUser {
  userId: string,
  userProperties: Map<string, string>;
}

// Initialize an empty Map to store session objects by their name
const sessions = new Map<string, Session>();
const users = new Map<string, SessionUser>();

function sendMessageToOtherConnections(connectionId: string, message: string) {
  for (const [id, conn] of connections) {
    if (id !== connectionId) {
      conn.send(message);
    }
  }
}

function sendMessageToOtherSessionUsers(connectionId: string, sessionName: string, message: string): void {
  if (sessions.has(sessionName)) {
    const session = sessions.get(sessionName);
    if (session) {
      // Send the message to all connections except the sender
      for (const [id, conn] of connections) {
        if (id !== connectionId && (session.readers.includes(id) || session.editors.includes(id))) {
          conn.send(message);
        }
      }
    }
  }
}

function getSessionUsers(sessionName: string): SessionUser[] {
  const session = sessions.get(sessionName);
  let sessionUsers: SessionUser[] = session ? Array.from(users.values()).filter(u => session.editors.includes(u.userId) || session.readers.includes(u.userId)) : [];

  return sessionUsers;
}

wss.on('connection', (ws: WebSocket, req: Request) => {
  // Generate a new UUID for the connection
  const connectionId = uuid();

  // Save the connection with its ID
  connections.set(connectionId, ws);

  // generate a user key for new user
  const userProperties = new Map<string, string>();
  const displayName = `user-${connectionId}`;
  userProperties.set('displayName', displayName);
  users.set(connectionId, { userId: connectionId, userProperties });

  // Parse the query string from the request URL
  const params = new URLSearchParams(req.url.split('?')[1]);
  // Get the session name from the query string
  const sessionName = params.get('sessionName') as string;
  const sessionKey = params.get('sessionKey') as string;

  // Get the session object for the given session name
  const session = sessions.get(sessionName);

  // Check if the session exists
  if (session) {
    // Check if the session key matches the session key of the session
    if (session.sessionKey === sessionKey) {
      // Add the connection ID to the list of editors for the session
      session.editors.push(connectionId);
    }
    else {
      session.readers.push(connectionId);
    }
  }

  // Handle incoming messages
  ws.on('message', (message: string) => {
    // Parse the incoming message as JSON
    const data = JSON.parse(message);

    // Log the received message
    console.log('Received message from connection %s: %o', connectionId, data);

    // Check if the message contains a 'session' property
    if (!sessions.has(sessionName)) {
      if (data.session) {
        // Add the session to the Map with the session name as the key
        sessions.set(sessionName, data.session);
      }
    }
    else {
      if (session && session.editors.includes(connectionId)) {
        sendMessageToOtherSessionUsers(connectionId, sessionName, JSON.stringify(data));
      }
    }

    if (data.user) {
      if (users.has(connectionId)) {
        users.set(connectionId, data.user);
      }
    }
  });

  // Send a feedback message with the connection ID and session name to the incoming connection
  ws.send(JSON.stringify({op: 'session connected', connectionId, sessionName }));
  // Send the list of current users
  ws.send(JSON.stringify({op: 'user list', 'users': getSessionUsers(sessionName)}));
  // Send all other session users
  sendMessageToOtherSessionUsers(connectionId, sessionName, JSON.stringify({ op: 'user joined', user: users.get(connectionId) }));
});

// Start the server
server.listen(process.env.PORT || 8999, () => {
  console.log(`Server started on port ${(server.address() as AddressInfo).port} :)`);
});