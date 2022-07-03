const path = require('path')
const WebSocket = require('ws')
const express = require('express')
const TonWeb = require('tonweb')

const state = {
  joinList: [],
  roomDict: {},
  nextRoomId: 0,
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
  console.log('Listening on http://localhost:3000')
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
    } else {
      console.log('unknown message: %s', msg)
    }
    // if (msg.command === 'getAddress') {
    //   ws.send(JSON.stringify({
    //     event: 'address',
    //     address: state.address.toString(true, true, true),
    //     publicKey: TonWeb.utils.bytesToBase64(state.keyPair.publicKey)
    //   }))
    // } else if (msg.command === 'initChannel') {
    //   initChannel(ws, msg)
    // } else if (msg.command === 'exit') {
    //   closeChannel(ws, msg)
    // } else if (msg.command === 'leave') {
    //   leaveRoom(ws)
    // } else if (msg.command === 'pick') {
    //   checkPick(ws, msg)
  })
  ws.on('close', function() {
    leaveRoom(ws)
  })
})

function queue(ws, msg) {
  ws.address = msg.address
  ws.publicKey = msg.publicKey
  state.joinList = state.joinList.filter(function(entry) {
    if (entry.address !== ws.address) {
      return true
    } else {
      entry.close()
      return false
    }
  })
  state.joinList.push(ws)
  ws.send(JSON.stringify({event: 'waiting'}))
  setTimeout(joinPlayers, 500)
}

function joinPlayers() {
  while (state.joinList.length >= 2) {
    const room =
      { playerA: state.joinList.pop()
      , playerB: state.joinList.pop()
      // , pickA: null
      // , pickB: null
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
  const nextChannelState = deserializeChannelState(msg.nextChannelState)
  const signatureB = deserializeSignature(msg.signatureB)
  if (nextChannelState.balanceA.toString() != ws.channelState.balanceA.toString()) {
    return console.log('balanceA mismatch')
  }
  if (nextChannelState.balanceB.toString() != ws.channelState.balanceB.sub(toNano('0.1')).toString()) {
    return console.log('balanceB not subtracted by 0.1')
  }
  if (nextChannelState.seqnoA.toString() != ws.channelState.seqnoA.toString()) {
    return console.log('seqnoA mismatch')
  }
  if (nextChannelState.seqnoB.toString() != ws.channelState.seqnoB.add(new BN('1')).toString()) {
    return console.log('seqnoB not added by 1')
  }
  if (!(await ws.channelA.verifyState(nextChannelState, signatureB))) {
    return console.log('signatureB is invalid')
  }
  ws.channelState = nextChannelState

  const pick = msg.pick
  const roomId = ws.roomId
  const room = state.roomDict[roomId]
  if (ws === room.playerA) {
    room.pickA = pick
  } else if (ws === room.playerB) {
    room.pickB = pick
  }
  const newMsg = JSON.stringify({
    event: 'picked',
    addressB: ws.addressB.toString(true, true, true)
  })
  room.playerA.send(newMsg)
  room.playerB.send(newMsg)
  checkRound(room)
}

function leaveRoom(ws) {
  state.joinList = state.joinList.filter(function(entry) {
    return entry !== ws
  })
  const newMsg = JSON.stringify({event: 'left'})
  ws.send(newMsg)
  const roomId = ws.roomId
  if (roomId != null) {
    const room = state.roomDict[roomId]
    state.roomDict[roomId] = null
    room.playerA.roomId = null
    room.playerB.roomId = null
    if (ws === room.playerA) {
      room.playerB.send(newMsg)
    } else {
      room.playerA.send(newMsg)
    }
  }
}

async function checkRound(room) {
  const a = room.pickA
  const b = room.pickB
  if (a != null && b != null) {
    await timeout(1000)
    const result = rpsCheckRule(a, b)
    if (result === 0) {
      giveBack(room.playerA)
      giveBack(room.playerB)
      const signaturePlayerA = await room.playerA.channelA.signState(room.playerA.channelState)
      const signaturePlayerB = await room.playerB.channelA.signState(room.playerB.channelState)
      room.playerA.send(JSON.stringify({
        event: 'draw',
        pick: room.pickB,
        channelState: serializeChannelState(room.playerA.channelState),
        signatureA: serializeSignature(signaturePlayerA)
      }))
      room.playerB.send(JSON.stringify({
        event: 'draw',
        pick: room.pickA,
        channelState: serializeChannelState(room.playerB.channelState),
        signatureA: serializeSignature(signaturePlayerB)
      }))
    } else if (result === 1) {
      giveBack(room.playerA)
      giveBack(room.playerA)
      const signaturePlayerA = await room.playerA.channelA.signState(room.playerA.channelState)
      room.playerA.send(JSON.stringify({
        event: 'won',
        pick: room.pickB,
        channelState: serializeChannelState(room.playerA.channelState),
        signatureA: serializeSignature(signaturePlayerA)
      }))
      room.playerB.send(JSON.stringify({
        event: 'lost',
        pick: room.pickA
      }))
    } else if (result === 2) {
      giveBack(room.playerB)
      giveBack(room.playerB)
      const signaturePlayerB = await room.playerB.channelA.signState(room.playerB.channelState)
      room.playerA.send(JSON.stringify({
        event: 'lost',
        pick: room.pickB,
      }))
      room.playerB.send(JSON.stringify({
        event: 'won',
        pick: room.pickA,
        channelState: serializeChannelState(room.playerB.channelState),
        signatureA: serializeSignature(signaturePlayerB)
      }))
    }
    room.pickA = null
    room.pickB = null
  }
}

function giveBack(ws) {
  const nextChannelState = {
    balanceA: ws.channelState.balanceA.sub(toNano('0.1')),
    balanceB: ws.channelState.balanceB.add(toNano('0.1')),
    seqnoA: ws.channelState.seqnoA.add(new BN('1')),
    seqnoB: ws.channelState.seqnoB
  }
  ws.channelState = nextChannelState
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

function initChannel(ws, msg) {
  const channelInitState = {
    balanceA: new BN(msg.balanceA),
    balanceB: new BN(msg.balanceB),
    seqnoA: new BN(0),
    seqnoB: new BN(0)
  }
  const channelConfig = {
    channelId: new BN(msg.channelId),
    addressA: state.address,
    addressB: new TonWeb.utils.Address(msg.addressB),
    initBalanceA: channelInitState.balanceA,
    initBalanceB: channelInitState.balanceB
  }
  const channelA = tonweb.payments.createChannel({
    ...channelConfig,
    isA: true,
    myKeyPair: state.keyPair,
    hisPublicKey: TonWeb.utils.base64ToBytes(msg.publicKeyB)
  })
  const fromWalletA = channelA.fromWallet({
    wallet: state.wallet,
    secretKey: state.keyPair.secretKey
  })
  const checkBalanceA = function() {
    return channelA.getData().then(function(data) {
      if (data.balanceA.toString() !== '0') {
        return
      } else {
        return timeout(1000).then(checkBalanceA)
      }
    })
  }
  fromWalletA
  .topUp({coinsA: channelInitState.balanceA, coinsB: new BN(0)})
  .send(channelInitState.balanceA.add(toNano('0.05')))
  .then(checkBalanceA)
  .then(function() {
    return fromWalletA.init(channelInitState).send(toNano('0.05'))
  })
  .then(function() {
    ws.channelState = channelInitState
    ws.addressB = channelConfig.addressB
    ws.channelA = channelA
    ws.fromWalletA = fromWalletA
    ws.send(JSON.stringify({event: 'channelInitialized'}))
  })
  .catch(function(e) {
    console.log('error in initializing channel: %s', e)
    ws.send(JSON.stringify({event: 'error', text: 'error in initializing channel'}))
  })
}

async function closeChannel(ws, msg) {
  const signatureCloseB = deserializeSignature(msg.signatureCloseB)
  const valid = await ws.channelA.verifyClose(ws.channelState, signatureCloseB)
  if (!valid) {
    ws.send(JSON.stringify({event: 'error', text: 'Cannot verify close signature'}))
  } else {
    const waitForClosure = function() {
      return ws.channelA.getChannelState().then(function(state){
        console.log('close state: %s', state)
        if (state === 0) {
          return
        } else {
          return timeout(1000).then(waitForClosure)
        }
      })
    }
    ws.fromWalletA.close({
      ...ws.channelState,
      hisSignature: signatureCloseB
    }).send(toNano('0.05'))
    .then(waitForClosure)
    .then(function() {
      ws.send(JSON.stringify({event: 'closed'}))
    })
    .catch(function(e) {
      console.log('error in closing channel: %s', e)
    })
  }
}

function serializeChannelState(channelState) {
  return {
    balanceA: channelState.balanceA.toString(),
    balanceB: channelState.balanceB.toString(),
    seqnoA: channelState.seqnoA.toString(),
    seqnoB: channelState.seqnoB.toString()
  }
}

function deserializeChannelState(channelState) {
  return {
    balanceA: new BN(channelState.balanceA),
    balanceB: new BN(channelState.balanceB),
    seqnoA: new BN(channelState.seqnoA),
    seqnoB: new BN(channelState.seqnoB)
  }
}

function serializeSignature(signature) {
  return TonWeb.utils.bytesToBase64(signature)
}

function deserializeSignature(signature) {
  return TonWeb.utils.base64ToBytes(signature)
}

// Utility

function timeout(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}
