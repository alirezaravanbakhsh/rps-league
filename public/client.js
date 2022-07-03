function findOne(q) {
  return document.querySelector(q)
}

function hide(el) {
  el.style.display = 'none'
}

function hideAll() {
  const divEls = document.querySelectorAll('main>div')
  divEls.forEach(function (divEl) {
    if (divEl.id !== 'errorView' && divEl.id !== 'channelBalanceView') {
      hide(divEl)
    }
  })
}

function show(el) {
  hideAll()
  el.style.display = ''
  const input = el.querySelector('input')
  if (input != null) {
    input.focus()
  }
}

function showError(msg) {
  errorViewEl.innerText = msg
}

function hideError() {
  errorViewEl.innerText = ' '
}

function timeout(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}

const channelBalanceViewEl = findOne('#channelBalanceView')
const channelBalanceEl = findOne('#channelBalance')

const errorViewEl = findOne('#errorView')

const walletViewEl = findOne('#walletView')

const balanceViewEl = findOne('#balanceView')
const balanceFieldEl = findOne('#balanceField')
const balanceAddressEl = findOne('#balanceAddress')
const balanceCreateChannelEl = findOne('#balanceCreateChannel')

const createChannelViewEl = findOne('#createChannelView')

const initChannelViewEl = findOne('#initChannelView')

const connectingViewEl = findOne('#connectingView')

const hallViewEl = findOne('#hallView')
const hallJoinEl = findOne('#hallJoin')
const hallExitEl = findOne('#hallExit')

const waitViewEl = findOne('#waitView')
const waitLeaveEl = findOne('#waitLeave')

const gameViewEl = findOne('#gameView')
const gameRoomEl = findOne('#gameRoom')
const gameLeaveEl = findOne('#gameLeave')
const gamePickREl = findOne('#gamePickR')
const gamePickPEl = findOne('#gamePickP')
const gamePickSEl = findOne('#gamePickS')
const gameYourPickEl = findOne('#gameYourPick')
const gameTheirPickEl = findOne('#gameTheirPick')
const gameDrawEl = findOne('#gameDraw')
const gameWonEl = findOne('#gameWon')
const gameLostEl = findOne('#gameLost')

const state = {
  wsServer: null,
  channelId: null,
  seed: null,
  keyPair: null,
  wallet: null,
  publicKeyA: null,
  addressA: null,
  addressB: null,
  balance: null,
  channelB: null,
  fromWalletB: null,
  channelState: null
}

hideAll()
hide(channelBalanceViewEl)
setupWebSocket()

// TonWeb
const TonWeb = window.TonWeb
const BN = TonWeb.utils.BN
const toNano = TonWeb.utils.toNano
const fromNano = TonWeb.utils.fromNano
const providerUrl = 'https://testnet.toncenter.com/api/v2/jsonRPC'
const apiKey = '0b673465b3dff8f572d26adb553f2bdabcd894c19d7b74c8104d6b3fb56b00bc'
const tonweb = new TonWeb(new TonWeb.HttpProvider(providerUrl, {apiKey}))

async function setupWallet(addressA, publicKeyA) {
  show(walletViewEl)
  const channelId = localStorage.getItem('channelId') || '1'
  state.channelId = new BN(channelId)
  const seedBase64 = localStorage.getItem('seed')
  let seed = null
  if (seedBase64) {
    seed = TonWeb.utils.base64ToBytes(seedBase64)
  } else {
    seed = TonWeb.utils.newSeed()
    localStorage.setItem('seed', TonWeb.utils.bytesToBase64(seed))
  }
  state.seed = seed
  state.keyPair = TonWeb.utils.keyPairFromSeed(seed)
  state.wallet = tonweb.wallet.create({publicKey: state.keyPair.publicKey, wc: 0})
  state.publicKeyA = TonWeb.utils.base64ToBytes(publicKeyA)
  state.addressA = new TonWeb.utils.Address(addressA)
  state.addressB = await state.wallet.getAddress()
  await checkBalance()
}

async function checkBalance() {
  balanceFieldEl.innerText = '...'
  balanceAddressEl.innerText = state.addressB.toString(true, true, true)
  show(balanceViewEl)
  balance = await tonweb.getBalance(state.addressB)
  state.balance = new BN(balance)
  balanceFieldEl.innerText = fromNano(state.balance)
}

balanceCreateChannelEl.addEventListener('click', function() {
  hideError()
  tonweb.getBalance(state.addressB).then(function(balance) {
    state.balance = new BN(balance)
    balanceFieldEl.innerText = fromNano(state.balance)
    if (state.balance >= toNano('1')) {
      createChannel()
    } else {
      showError('Please first deposit at least 1 TON to your wallet on testnet.')
    }
  })
})

async function createChannel() {
  show(createChannelViewEl)
  const channelInitState = {
    balanceA: toNano('1'),
    balanceB: toNano('1'),
    seqnoA: new BN(0),
    seqnoB: new BN(0)
  }
  state.channelState = channelInitState
  const channelConfig = {
    channelId: state.channelId,
    addressA: state.addressA,
    addressB: state.addressB,
    initBalanceA: channelInitState.balanceA,
    initBalanceB: channelInitState.balanceB
  }
  state.channelB = tonweb.payments.createChannel({
    ...channelConfig,
    isA: false,
    myKeyPair: state.keyPair,
    hisPublicKey: state.publicKeyA
  })
  state.fromWalletB = state.channelB.fromWallet({
    wallet: state.wallet,
    secretKey: state.keyPair.secretKey
  })
  const channelAddress = await state.channelB.getAddress()
  console.log('channel address: %s', channelAddress.toString(true, true, true))
  try {
    const channelState = await state.channelB.getChannelState()
    console.log('channel state: %s', channelState)
  } catch (e) {
    await state.fromWalletB.deploy().send(toNano('0.05'))
    let i = 30
    while (i > 0) {
      i -= 1
      try {
        const channelState = await state.channelB.getChannelState()
        console.log('channel state: %s', channelState)
        break
      } catch (e) {
      }
      await timeout(1000)
    }
  }
  const data = await state.channelB.getData()
  console.log(data)
  console.log('balanceA: %s', data.balanceA.toString())
  console.log('balanceB: %s', data.balanceB.toString())
  if (data.balanceB.toString() === '0') {
    await state.fromWalletB
      .topUp({coinsA: new BN(0), coinsB: channelInitState.balanceB})
      .send(channelInitState.balanceB.add(toNano('0.05')))
    let i = 30
    while (i > 0) {
      i -= 1
      try {
        const data = await state.channelB.getData()
        console.log('balanceB: %s', data.balanceB.toString())
        if (data.balanceB.toString() !== '0') {
          break
        }
      } catch (e) {
      }
      await timeout(1000)
    }
    }
  state.wsServer.send(JSON.stringify({
    command: 'initChannel',
    balanceA: channelInitState.balanceA.toString(),
    balanceB: channelInitState.balanceB.toString(),
    channelId: channelConfig.channelId.toString(),
    addressB: state.addressB.toString(true, true, true),
    publicKeyB: TonWeb.utils.bytesToBase64(state.keyPair.publicKey)
  }))
  waitForInit()
}

async function waitForInit() {
  show(initChannelViewEl)
}

async function checkInitialized() {
  const data = await state.channelB.getData()
  console.log(data)
  console.log('balanceA: %s', data.balanceA.toString())
  console.log('balanceB: %s', data.balanceB.toString())
  x = await state.fromWalletB.init(state.channelInitState).send(toNano('0.05'))
  console.log('x: %o', x)
  let i = 30
  while (i > 0) {
    i -= 1
    try {
      const channelState = await state.channelB.getChannelState()
      console.log('channel state: %s', channelState)
      if (channelState !== 0) {
        break
      }
    } catch (e) {
    }
    await timeout(1000)
  }
  show(hallViewEl)
  showChannelBalance()
  hideError()
}

function setupWebSocket() {
  const url = "ws://localhost:3000/myWebsocket"
  const wsServer = new WebSocket(url)
  state.wsServer = wsServer

  wsServer.onerror = function() {
    showError('Error connecting to websocket server.')
  }

  wsServer.onclose = function() {
    hideAll()
    showError('Connection to websocket closed.')
  }

  wsServer.onopen = function() {
    wsServer.send(JSON.stringify({command: 'getAddress'}))
  }

  wsServer.onmessage = function(m) {
    const msg = JSON.parse(m.data)
    if (msg.event === 'error') {
      showError(msg.text)
    } else if (msg.event === 'address') {
      setupWallet(msg.address, msg.publicKey)
    } else if (msg.event === 'channelInitialized') {
      checkInitialized()
    } else if (msg.event === 'waiting') {
      show(waitViewEl)
      hideError()
    } else if (msg.event === 'closed') {
      wsServer.send(JSON.stringify({command: 'getAddress'}))
    } else if (msg.event === 'left') {
      gameYourPickEl.innerText = ''
      gameTheirPickEl.innerText = ''
      show(hallViewEl)
    } else if (msg.event === 'joined') {
      const roomId = msg.roomId
      gameRoomEl.innerText = roomId
      show(gameViewEl)
      clearResult()
    } else if (msg.event === 'picked') {
      if (msg.addressB !== state.addressB.toString(true, true, true)) {
        gameTheirPickEl.innerText = '☑️'
      }
    } else if (msg.event === 'draw') {
      state.channelState = deserializeChannelState(msg.channelState)
      gameTheirPickEl.innerText = icon(msg.pick)
      showResult('draw')
      showChannelBalance()
      setTimeout(function() {
        clearResult()
        enablePickButtons()
      }, 2000)
    } else if (msg.event === 'won') {
      state.channelState = deserializeChannelState(msg.channelState)
      gameTheirPickEl.innerText = icon(msg.pick)
      showResult('won')
      showChannelBalance()
      setTimeout(function() {
        clearResult()
        enablePickButtons()
      }, 2000)
    } else if (msg.event === 'lost') {
      gameTheirPickEl.innerText = icon(msg.pick)
      showResult('lost')
      showChannelBalance()
      setTimeout(function() {
        clearResult()
        enablePickButtons()
      }, 2000)
    } else {
      console.log('unknown message: %s', msg)
    }
  }
}

hallJoinEl.addEventListener('click', function() {
  state.wsServer.send(JSON.stringify({command: 'join'}))
})

hallExitEl.addEventListener('click', function() {
  state.channelB.signClose(state.channelState)
  .then(function(signatureCloseB){
    state.wsServer.send(JSON.stringify({
      command: 'exit',
      signatureCloseB: serializeSignature(signatureCloseB)
    }))
  })
})

waitLeaveEl.addEventListener('click', function() {
  state.wsServer.send(JSON.stringify({command: 'leave'}))
})

gameLeaveEl.addEventListener('click', function() {
  state.wsServer.send(JSON.stringify({command: 'leave'}))
})

function getChannelStateForNextRound() {
  return nextChannelState = {
    balanceA: state.channelState.balanceA,
    balanceB: state.channelState.balanceB.sub(toNano('0.1')),
    seqnoA: state.channelState.seqnoA,
    seqnoB: state.channelState.seqnoB.add(new BN('1'))
  }
}

gamePickREl.addEventListener('click', function() {
  disablePickButtons()
  gameYourPickEl.innerText = icon('r')
  const nextChannelState = getChannelStateForNextRound()
  state.channelB.signState(nextChannelState).then(function(signatureB) {
    state.wsServer.send(JSON.stringify({
      command: 'pick',
      pick: 'r',
      nextChannelState: serializeChannelState(nextChannelState),
      signatureB: serializeSignature(signatureB)
    }))
    state.channelState = nextChannelState
    showChannelBalance()
  })
})

gamePickPEl.addEventListener('click', function() {
  disablePickButtons()
  gameYourPickEl.innerText = icon('p')
  const nextChannelState = getChannelStateForNextRound()
  state.channelB.signState(nextChannelState).then(function(signatureB) {
    state.wsServer.send(JSON.stringify({
      command: 'pick',
      pick: 'p',
      nextChannelState: serializeChannelState(nextChannelState),
      signatureB: serializeSignature(signatureB)
    }))
    state.channelState = nextChannelState
    showChannelBalance()
  })
})

gamePickSEl.addEventListener('click', function() {
  disablePickButtons()
  gameYourPickEl.innerText = icon('s')
  const nextChannelState = getChannelStateForNextRound()
  state.channelB.signState(nextChannelState).then(function(signatureB) {
    state.wsServer.send(JSON.stringify({
      command: 'pick',
      pick: 's',
      nextChannelState: serializeChannelState(nextChannelState),
      signatureB: serializeSignature(signatureB)
    }))
    state.channelState = nextChannelState
    showChannelBalance()
  })
})

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

function icon(x) {
  if (x === 'r') {
    return '✊'
  } else if (x === 'p') {
    return '🖐'
  } else if (x === 's') {
    return '✌️'
  }
}

function disablePickButtons() {
  gamePickREl.disabled = true
  gamePickPEl.disabled = true
  gamePickSEl.disabled = true
}

function enablePickButtons() {
  gamePickREl.disabled = false
  gamePickPEl.disabled = false
  gamePickSEl.disabled = false
}

function showChannelBalance() {
  channelBalanceViewEl.style.display = ''
  channelBalanceEl.innerText = fromNano(state.channelState.balanceB)
}

function showResult(r) {
  gameDrawEl.style.display = 'none'
  gameWonEl.style.display = 'none'
  gameLostEl.style.display = 'none'
  if (r === 'draw') {
    gameDrawEl.style.display = ''
  } else if (r === 'won') {
    gameWonEl.style.display = ''
  } else if (r === 'lost') {
    gameLostEl.style.display = ''
  }
}

function clearResult() {
  gameDrawEl.style.display = 'none'
  gameWonEl.style.display = 'none'
  gameLostEl.style.display = 'none'
  gameYourPickEl.innerText = ''
  gameTheirPickEl.innerText = ''
  enablePickButtons()
}
