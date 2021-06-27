import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import socketio from 'socket.io';
import cors from 'cors';

import { ApolloServer, gql } from 'apollo-server-express'

import EventEmitter from 'eventemitter3';
const em = new EventEmitter();

import {
  getConversations,
  makeUser,
  getConversation,
  getUserId,
  sendMessage,
  searchUsers
} from "./db";

//#region Apollo Server
// Construct a schema, using GraphQL schema language
const typeDefs = gql`
  type Query {
    conversations(forUser: Int!): [Conversation]
    conversation(sender: Int!, recipient: Int!): [Message]
  }

  type Subscription {
    messageStored(messageId: Int!): Message
  }

  type Conversation {
    message_id: Int
    body: String
    other_username: String
    created_at: String
    avatar_url: String
  }
  
  type Message {
    body: String
    created_at: String
    sender_username: String
    recipient_username: String
    sender: Int
    recipient: Int
    message_id: Int
  }
`;

// Provide resolver functions for your schema fields
const resolvers = {
  Query: {
    conversation: async (_parent: any, { sender, recipient }: { sender: number, recipient: number }) => await getConversation(sender, recipient),
    conversations: async (_parent: any, { forUser }: { forUser: number }) => {
      return await getConversations(forUser)
    },
  },
  Subscription: {
    messageStored: {
      subscribe: () => {},
    },
  },
};

const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
});
//#endregion

// JWT for authentication with Auth0
const jwt = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const jwtDecode = require('jwt-decode');

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://bigbisonchat.auth0.com/.well-known/jwks.json`
  }),

  // Validate the audience and the issuer.
  aud: 'https://bigbisonchat.herokuapp.com',
  issuer: `https://bigbisonchat.auth0.com/`,
  algorithms: ['RS256']
});

const corsOptions = {
  origin: process.env.PORT ? 'https://chat.bigbison.co' : 'http://localhost:3000',
  optionsSuccessStatus: 200
};

// server initialization
const app = express();
const server = new http.Server(app);
const io = socketio(server, { origins: process.env.PORT ? 'https://chat.bigbison.co' : 'http://localhost:3000' });

// middleware
const ignoreFavicon = (req: Request, res: Response, next: NextFunction) => {
  if (req.originalUrl === "/favicon.ico") {
    res.status(204).end();
  } else {
    next();
  }
}

const excludedRoutes = [/\/((?!ping).)*/];

app.use(express.json());
app.use(cors(corsOptions));
app.use(ignoreFavicon);

if (process.env.NODE_ENV === 'production') {
  app.use(excludedRoutes, checkJwt);
}

apolloServer.applyMiddleware({ app });

// TODO: change this name.. decodeSub is a bit of a misnomer
// since it does more than that
function decodeSubFromRequestHeader(request: Request) {
  if (process.env.NODE_ENV !== 'production') {
    return {
      sub: 'rodrigoOpenId',
      username: 'rodrigo'
    }
  }
  
  const jwt = request.header('authorization')?.split(" ")[1];
  const decodedJwt = jwtDecode(jwt);
  return {
    sub: decodedJwt.sub,
    username: decodedJwt.nickname,
    picture: decodedJwt.picture
  }
}

// create unique and deterministic event name for a conversation
function determineEventNameFromUsernames(username1: string, username2: string) {
  return [username1, username2].sort().join('-');
};

// get list of conversations, with most recent message
app.get('/conversations', async (req, res) => {
  const userInfo = decodeSubFromRequestHeader(req);

  try {
    await makeUser(userInfo.username, userInfo.sub, userInfo.picture);
    const userId = await getUserId(userInfo.username);
    const conversations = await getConversations(userId);

    res.json(conversations);
  } catch(err) {
    await makeUser(userInfo.username, userInfo.sub, userInfo.picture).catch(err => console.log(err));
    res.redirect(req.originalUrl);
  }
})

// get list of messages between two users
app.get('/conversations/:username', async (req, res) => {
  const userInfo = decodeSubFromRequestHeader(req);
  const userId = await getUserId(userInfo.username);
  const otherUserId = await getUserId(req.params.username);

  const messages = await getConversation(userId, otherUserId, req.query.offset);
  res.json(messages);
})

// send message to a user from a user
app.post("/conversations/:username", async (req, res) => {
  try {
    const userInfo = decodeSubFromRequestHeader(req);
    const userId = await getUserId(userInfo.username)
    const otherUserId = await getUserId(req.params.username);
    const messageBody = req.body.messageBody;

    const insertedMessage = await sendMessage(userId, otherUserId, messageBody);

    const eventName = determineEventNameFromUsernames(userInfo.username, req.params.username);

    em.emit('post', eventName, insertedMessage);

    res.sendStatus(200);
    return;
  } catch (err) {
    res.sendStatus(400);
    return;
  }
});

app.get('/search/users/:query', async (req, res) => {
  const usernameResults = await searchUsers(req.params.query + '%');
  res.json(usernameResults);
});

app.get("/ping", (_req, res) => {
  res.sendStatus(200);
});

app.get("*", (_req, res) => {
  res.sendStatus(404);
});

io.on('connection', socket => {
  em.on('post', (eventName, payload) => {
    socket.emit(eventName, payload);
  });
})

const port = Number(process.env.PORT) || 8080;
server.listen(port, async () => {
  console.log(`server listening on port ${port}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server')
  server.close(() => {
    console.log('HTTP server closed')
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server')
  server.close(() => {
    console.log('HTTP server closed')
  })
})