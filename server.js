const path = require('path')
const WebSocket = require('ws')
const express = require('express')
const TonWeb = require('tonweb')

const state = {
  joinList: [],
  roomDict: {},
  nextRoomId: 300,
}

// TonWeb
const BN = TonWeb.utils.BN
const toNano = TonWeb.utils.toNano
const fromNano = TonWeb.utils.fromNano
const providerUrl = 'https://testnet.toncenter.com/api/v2/jsonRPC'
const apiKey = '0b673465b3dff8f572d26adb553f2bdabcd894c19d7b74c8104d6b3fb56b00bc'
const tonweb = new TonWeb(new TonWeb.HttpProvider(providerUrl, {apiKey}))

const app = express()
app.use('/', express.static(path.resolve(__dirname, './public')))
const myServer = app.listen(3000, function() {
  console.log('Listening on http://0.0.0.0:3000')
})

const wsServer = new WebSocket.Server({
  noServer: true
})

myServer.on('upgrade', async function upgrade(request, socket, head) {
  wsServer.handleUpgrade(request, socket, head, function(ws) {
    wsServer.emit('connection', ws, request)
  })
})

wsServer.on('connection', function(ws) {
  ws.on('message', function(m) {
    const msg = JSON.parse(m.toString())
    if (msg.command === 'join') {
      queue(ws, msg)
    } else if (msg.command === 'pick') {
      checkPick(ws, msg)
    } else if (msg.command === 'leave') {
      leaveRoom(ws, msg)
    } else {
      console.error('unknown message', msg)
    }
  })
  ws.on('close', function() {
    dequeue(ws)
  })
})

function queue(ws, msg) {
  ws.address = msg.address
  ws.publicKey = msg.publicKey
  state.joinList = state.joinList.filter(function(entry) {
    if (entry === ws) {
      return false
    } else if (entry.address === ws.address) {
      return false
    } else {
      return true
    }
  })
  state.joinList.push(ws)
  ws.send(JSON.stringify({event: 'waiting'}))
  setTimeout(joinPlayers, 500)
}

function dequeue(ws) {
  state.joinList = state.joinList.filter(function(entry) {
    return entry !== ws
  })
}

function joinPlayers() {
  while (state.joinList.length >= 2) {
    const room =
      { playerA: state.joinList.pop()
      , playerB: state.joinList.pop()
      , pickA: null
      , pickB: null
      }
    state.nextRoomId += 1
    const roomId = state.nextRoomId
    room.playerA.roomId = roomId
    room.playerB.roomId = roomId
    state.roomDict[roomId] = room
    room.playerA.send(JSON.stringify(
      { event: 'joined'
      , roomId: roomId
      , isA: true
      , hisAddress: room.playerB.address
      , hisPublicKey: room.playerB.publicKey
      }
    ))
    room.playerB.send(JSON.stringify(
      { event: 'joined'
      , roomId: roomId
      , isA: false
      , hisAddress: room.playerA.address
      , hisPublicKey: room.playerA.publicKey
      }
    ))
  }
}

async function checkPick(ws, msg) {
  const pick = msg.pick
  const roomId = ws.roomId
  const room = state.roomDict[roomId]
  let isA
  if (ws === room.playerA) {
    room.pickA = pick
    isA = true
  } else {
    room.pickB = pick
    isA = false
  }
  const newMsg = JSON.stringify({
    event: 'picked',
    isA: isA
  })
  room.playerA.send(newMsg)
  room.playerB.send(newMsg)
  checkRound(room)
}

async function checkRound(room) {
  const a = room.pickA
  const b = room.pickB
  if (a != null && b != null) {
    await timeout(1000)
    const result = rpsCheckRule(a, b)
    if (result === 0) {
      room.playerA.send(JSON.stringify(
        { event: 'draw'
        , pick: room.pickB
        }
      ))
      room.playerB.send(JSON.stringify(
        { event: 'draw'
        , pick: room.pickA
        }
      ))
    } else if (result === 1) {
      room.playerA.send(JSON.stringify(
        { event: 'won'
        , pick: room.pickB
        }
      ))
      room.playerB.send(JSON.stringify(
        { event: 'lost'
        , pick: room.pickA
        }
      ))
    } else if (result === 2) {
      room.playerA.send(JSON.stringify(
        { event: 'lost'
        , pick: room.pickB
        }
      ))
      room.playerB.send(JSON.stringify(
        { event: 'won'
        , pick: room.pickA
        }
      ))
    }
    room.pickA = null
    room.pickB = null
  }
}

function leaveRoom(ws, msg) {
  const roomId = ws.roomId
  const room = state.roomDict[roomId]
  if (room) {
    state.roomDict[roomId] = null
    room.playerA.roomId = null
    room.playerB.roomId = null
    const newMsg = JSON.stringify(
      { event: 'left'
      , signature: msg.signature
      }
    )
    if (ws === room.playerA) {
      room.playerB.send(newMsg)
    } else {
      room.playerA.send(newMsg)
    }
  }
}

function rpsCheckRule(a, b) {
  if (a === 'r' && b === 'p') {
    return 2
  } else if (a === 'p' && b === 's') {
    return 2
  } else if (a === 's' && b === 'r') {
    return 2
  } else if (a === 'r' && b === 's') {
    return 1
  } else if (a === 'p' && b === 'r') {
    return 1
  } else if (a === 's' && b === 'p') {
    return 1
  } else {
    return 0
  }
}

// Utility

function timeout(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}
