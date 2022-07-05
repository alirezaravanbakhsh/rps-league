const TonWeb = window.TonWeb

const state =
  { wsServer: null
  , seed: null
  , keyPair: null
  , address: null
  , wallet: null
  , balance: null
  , timer: null
  , channel: null
  , fromWallet: null
  , channelState: null
  , roomId: null
  , isA: null
  , picked: null
  }

// TonWeb
const BN = TonWeb.utils.BN
const toNano = TonWeb.utils.toNano
const fromNano = TonWeb.utils.fromNano
const providerUrl = 'https://testnet.toncenter.com/api/v2/jsonRPC'
const apiKey = '0b673465b3dff8f572d26adb553f2bdabcd894c19d7b74c8104d6b3fb56b00bc'
const tonweb = new TonWeb(new TonWeb.HttpProvider(providerUrl, {apiKey}))

hideAllPanes()
hideLoading()
setupWebSocket()

function setupWebSocket() {
  const connectingPaneEl = findOne('#connectingPane')
  showOnlyPane(connectingPaneEl)
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/myWebsocket'
  const wsServer = new WebSocket(url)
  state.wsServer = wsServer

  wsServer.onerror = function(e) {
    showError('Error connecting to websocket server.', e)
  }

  wsServer.onopen = function() {
    setupWallet()
  }

  wsServer.onclose = function() {
    clearTimeout(state.timer)
    showOnlyPane(connectingPaneEl)
    showError('Connection to websocket closed.')
    timeout(5000).then(setupWebSocket)
  }

  wsServer.onmessage = function(m) {
    const msg = JSON.parse(m.data)
    if (msg.event === 'error') {
      showError(msg.text)
    } else if (msg.event === 'waiting') {
      showWaitRoomPane()
    } else if (msg.event === 'joined') {
      const hisAddress = new TonWeb.utils.Address(msg.hisAddress)
      const hisPublicKey = deserialize(msg.hisPublicKey)
      setupChannel(msg.roomId, msg.isA, hisAddress, hisPublicKey)
    } else if (msg.event === 'picked') {
      gamePicked(msg.isA)
    } else if (msg.event === 'left') {
      gameClose(msg.signature)
    } else if (msg.event === 'draw') {
      gameDraw(msg.pick)
    } else if (msg.event === 'won') {
      gameWon(msg.pick)
    } else if (msg.event === 'lost') {
      gameLost(msg.pick)
    } else {
      console.error('unknown message:', msg)
    }
  }
}

async function setupWallet() {
  if (state.seed == null) {
    const existingSeed = localStorage.getItem('seed')
    if (existingSeed) {
      state.seed = TonWeb.utils.base64ToBytes(existingSeed)
    } else {
      state.seed = TonWeb.utils.newSeed()
      localStorage.setItem('seed', TonWeb.utils.bytesToBase64(state.seed))
    }
    state.keyPair = TonWeb.utils.keyPairFromSeed(state.seed)
    state.wallet = tonweb.wallet.create({publicKey: state.keyPair.publicKey, wc: 0})
    state.address = await state.wallet.getAddress()
    console.log('my wallet address:', state.address.toString(true, true, true))
  }
  const walletAddressEl = findOne('#walletAddress')
  walletAddressEl.innerText = state.address.toString(true, true, true)
  const walletPaneEl = findOne('#walletPane')
  showOnlyPane(walletPaneEl)
  refreshBalance()
}

async function refreshBalance() {
  balance = await getBalance(state.address)
  state.balance = new BN(balance)
  const walletBalanceEl = findOne('#walletBalance')
  walletBalanceEl.innerText = fromNano(state.balance)
  clearTimeout(state.timer)
  state.timer = setTimeout(refreshBalance, 2000)
}

const playNowEl = findOne('#playNow')
playNowEl.addEventListener('click', function() {
  hideError()
  if (state.balance.gte(toNano('2'))) {
    console.log('start playing with wallet balance of', fromNano(state.balance))
    state.wsServer.send(JSON.stringify(
      { command: 'join'
      , address: state.address.toString(true, true, true)
      , publicKey: serialize(state.keyPair.publicKey)
      }
    ))
  } else {
    showError('Please deposit at least 2 TON to your wallet on testnet.')
  }
})

function showWaitRoomPane() {
  clearTimeout(state.timer)
  const waitPaneEl = findOne('#waitPane')
  showOnlyPane(waitPaneEl)
}

const waitLeaveEl = findOne('#waitLeave')
waitLeaveEl.addEventListener('click', function() {
  state.wsServer.onclose = null
  state.wsServer.close()
  setupWebSocket()
})

async function setupChannel(roomId, isA, hisAddress, hisPublicKey) {
  const createChannelPaneEl = findOne('#createChannelPane')
  showOnlyPane(createChannelPaneEl)
  state.roomId = roomId
  state.isA = isA
  state.channelState =
    { balanceA: toNano('1')
    , balanceB: toNano('1')
    , seqnoA: new BN(0)
    , seqnoB: new BN(0)
    }
  // For channelId, roomId can also be used to make them more likely to be created on each game.
  // However, while developing, you may make mistakes and the balance may lock-up in the channel.
  // By using a fixed channel id, every time it will be used, and when the mistake is fixed,
  // balance will be usable again.
  state.channel = tonweb.payments.createChannel(
    { channelId: 0
    , addressA: isA ? state.address : hisAddress
    , addressB: isA ? hisAddress : state.address
    , initBalanceA: state.channelState.balanceA
    , initBalanceB: state.channelState.balanceB
    , isA: isA
    , myKeyPair: state.keyPair
    , hisPublicKey: hisPublicKey
    }
  )
  state.fromWallet = state.channel.fromWallet(
    { wallet: state.wallet
    , secretKey: state.keyPair.secretKey
    }
  )
  const channelAddress = await state.channel.getAddress()
  console.log('channel address:', channelAddress.toString(true, true, true))
  try {
    const s = await getChannelState()
    console.log('skipping creation')
  } catch (e) {
    console.log('waiting for channel creation...')
    if (isA) {
      await deployChannel()
    }
    const waitForChannelCreation = function() {
      return getChannelState().then(function(s) {
        if (s === 0) {
          return
        } else {
          return timeout(1000).then(waitForChannelCreation)
        }
      }).catch(function() {
        return timeout(1000).then(waitForChannelCreation)
      })
    }
    await waitForChannelCreation()
  }
  const data = await getData()
  state.channelState.seqnoA = data.seqnoA
  state.channelState.seqnoB = data.seqnoB
  const topUpPaneEl = findOne('#topUpPane')
  showOnlyPane(topUpPaneEl)
  if (isA && state.channelState.balanceA.gt(data.balanceA)) {
    console.log('waiting for channel top-up...')
    await state.fromWallet
      .topUp({coinsA: state.channelState.balanceA.sub(data.balanceA), coinsB: new BN(0)})
      .send(state.channelState.balanceA.sub(data.balanceA).add(toNano('0.05')))
    const waitForTopUpA = function() {
      return getData().then(function(data) {
        if (state.channelState.balanceA.sub(data.balanceA).eq(new BN('0'))) {
          return
        } else {
          return timeout(1000).then(waitForTopUpA)
        }
      })
    }
    await waitForTopUpA()
  } else if (!isA && state.channelState.balanceB.gt(data.balanceB)) {
    console.log('waiting for channel top-up...')
    await state.fromWallet
      .topUp({coinsA: new BN(0), coinsB: state.channelState.balanceB.sub(data.balanceB)})
      .send(state.channelState.balanceB.sub(data.balanceB).add(toNano('0.05')))
    const waitForTopUpB = function() {
      return getData().then(function(data) {
        if (state.channelState.balanceB.sub(data.balanceB).eq(new BN('0'))) {
          return
        } else {
          return timeout(1000).then(waitForTopUpB)
        }
      })
    }
    await waitForTopUpB()
  } else {
    console.log('skipping top-up')
  }
  const initializingChannelPaneEl = findOne('#initializingChannelPane')
  showOnlyPane(initializingChannelPaneEl)
  const waitForChannelInit = function() {
    return getChannelState().then(function(s) {
      if (s === 1) {
        return
      } else {
        return timeout(1000).then(waitForChannelInit)
      }
    })
  }
  const s = await getChannelState()
  if (s === 1) {
    console.log('skipping init')
  } else {
    if (!isA) {
      await initChannel()
    }
    console.log('waiting for channel init...')
    await waitForChannelInit()
  }
  console.log('channel is ready')
  state.channelState =
    { balanceA: state.channelState.balanceA
    , balanceB: state.channelState.balanceB
    , seqnoA: state.channelState.seqnoA.add(new BN('1'))
    , seqnoB: state.channelState.seqnoB.add(new BN('1'))
    }
  startGame()
}

const gamePaneEl = findOne('#gamePane')
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

async function startGame() {
  showOnlyPane(gamePaneEl)
  clearResult()
  showChannelBalance()
  gameRoomEl.innerText = state.roomId
}

function leaveGame() {
  clearResult()
  disablePickButtons()
  if (state.picked) {
    state.channelState = getChannelStateForPreviousRound()
  }
  console.log('closing state', fromNano(state.channelState.balanceA), fromNano(state.channelState.balanceB), state.channelState.seqnoA.toString(), state.channelState.seqnoB.toString())
  state.channel.signClose(state.channelState).then(function(signature) {
    state.wsServer.send(JSON.stringify(
      { command: 'leave'
      , signature: serialize(signature)
      }
    ))
    clearResult()
    disablePickButtons()
    const closingChannelPaneEl = findOne('#closingChannelPane')
    showOnlyPane(closingChannelPaneEl)
    console.log('waiting for channel close...')
    waitForChannelClose().then(function() {
      console.log('channel closed')
    }).then(setupWebSocket)
  })
}

gameLeaveEl.addEventListener('click', leaveGame)

async function gameClose(signature) {
  if (state.picked) {
    state.channelState = getChannelStateForPreviousRound()
  }
  console.log('closing state', fromNano(state.channelState.balanceA), fromNano(state.channelState.balanceB), state.channelState.seqnoA.toString(), state.channelState.seqnoB.toString())
  const valid = await verifyClose(deserialize(signature))
  if (valid) {
    clearResult()
    disablePickButtons()
    const closingChannelPaneEl = findOne('#closingChannelPane')
    showOnlyPane(closingChannelPaneEl)
    // const data = await getData()
    // console.log('data:', fromNano(data.balanceA), fromNano(data.balanceB), data.seqnoA.toString(), data.seqnoB.toString(), data.channelId.toString(), data.addressA.toString(true, true, true), data.addressB.toString(true, true, true), data.publicKeyA.toString(), data.publicKeyB.toString())
    await closeChannel(deserialize(signature))
    console.log('waiting for channel close...')
    await waitForChannelClose()
    console.log('channel closed')
    setupWebSocket()
  } else {
    // console.log('channel state:', fromNano(state.channelState.balanceA), fromNano(state.channelState.balanceB), state.channelState.seqnoA.toString(), state.channelState.seqnoB.toString())
    console.error('invalid close signature')
  }
}

function waitForChannelClose() {
  return getChannelState().then(function (s){
    if (s === 0) {
      return
    } else {
      return timeout(1000).then(waitForChannelClose)
    }
  })
}

gamePickREl.addEventListener('click', function() {
  disablePickButtons()
  gameYourPickEl.innerText = icon('r')
  state.picked = true
  state.channelState = getChannelStateForNextRound()
  state.channel.signState(state.channelState).then(function(signature) {
    state.wsServer.send(JSON.stringify(
      { command: 'pick'
      , pick: 'r'
      , signature: serialize(signature)
      }
    ))
    showChannelBalance()
  })
})

gamePickPEl.addEventListener('click', function() {
  disablePickButtons()
  gameYourPickEl.innerText = icon('p')
  state.picked = true
  state.channelState = getChannelStateForNextRound()
  state.channel.signState(state.channelState).then(function(signature) {
    state.wsServer.send(JSON.stringify(
      { command: 'pick'
      , pick: 'p'
      , signature: serialize(signature)
      }
    ))
    showChannelBalance()
  })
})

gamePickSEl.addEventListener('click', function() {
  disablePickButtons()
  gameYourPickEl.innerText = icon('s')
  state.picked = true
  state.channelState = getChannelStateForNextRound()
  state.channel.signState(state.channelState).then(function(signature) {
    state.wsServer.send(JSON.stringify(
      { command: 'pick'
      , pick: 's'
      , signature: serialize(signature)
      }
    ))
    showChannelBalance()
  })
})

function showChannelBalance() {
  const channelBalanceEl = findOne('#channelBalance')
  channelBalanceEl.innerText = fromNano(
    state.isA ? state.channelState.balanceA : state.channelState.balanceB
  )
}

function gamePicked(isA) {
  if (isA != state.isA) {
    gameTheirPickEl.innerText = '☑️'
  }
}

function nextRound() {
  if (state.channelState.balanceA.lt(toNano('0.1')) || state.channelState.balanceB.lt(toNano('0.1'))) {
    leaveGame()
    return
  }
  clearResult()
  enablePickButtons()
}

function gameDraw(pick) {
  state.channelState = getChannelStateForPreviousRound()
  console.log('draw state', fromNano(state.channelState.balanceA), fromNano(state.channelState.balanceB), state.channelState.seqnoA.toString(), state.channelState.seqnoB.toString())
  state.picked = false
  gameTheirPickEl.innerText = icon(pick)
  showResult('draw')
  showChannelBalance()
  setTimeout(nextRound, 2000)
}

function gameWon(pick) {
  state.channelState = getChannelStateForWonRound()
  console.log('won state', fromNano(state.channelState.balanceA), fromNano(state.channelState.balanceB), state.channelState.seqnoA.toString(), state.channelState.seqnoB.toString())
  state.picked = false
  gameTheirPickEl.innerText = icon(pick)
  showResult('won')
  showChannelBalance()
  setTimeout(nextRound, 2000)
}

function gameLost(pick) {
  state.channelState = getChannelStateForLostRound()
  console.log('lost state', fromNano(state.channelState.balanceA), fromNano(state.channelState.balanceB), state.channelState.seqnoA.toString(), state.channelState.seqnoB.toString())
  state.picked = false
  gameTheirPickEl.innerText = icon(pick)
  showResult('lost')
  showChannelBalance()
  setTimeout(nextRound, 2000)
}

function getChannelStateForNextRound() {
  if (state.isA) {
    return (
      { balanceA: state.channelState.balanceA.sub(toNano('0.1'))
      , balanceB: state.channelState.balanceB.sub(toNano('0.1'))
      , seqnoA: state.channelState.seqnoA.add(new BN('1'))
      , seqnoB: state.channelState.seqnoB.add(new BN('1'))
      }
    )
  } else {
    return (
      { balanceA: state.channelState.balanceA.sub(toNano('0.1'))
      , balanceB: state.channelState.balanceB.sub(toNano('0.1'))
      , seqnoA: state.channelState.seqnoA.add(new BN('1'))
      , seqnoB: state.channelState.seqnoB.add(new BN('1'))
      }
    )
  }
}

function getChannelStateForPreviousRound() {
  if (state.isA) {
    return (
      { balanceA: state.channelState.balanceA.add(toNano('0.1'))
      , balanceB: state.channelState.balanceB.add(toNano('0.1'))
      , seqnoA: state.channelState.seqnoA.sub(new BN('1'))
      , seqnoB: state.channelState.seqnoB.sub(new BN('1'))
      }
    )
  } else {
    return (
      { balanceA: state.channelState.balanceA.add(toNano('0.1'))
      , balanceB: state.channelState.balanceB.add(toNano('0.1'))
      , seqnoA: state.channelState.seqnoA.sub(new BN('1'))
      , seqnoB: state.channelState.seqnoB.sub(new BN('1'))
      }
    )
  }
}

function getChannelStateForWonRound() {
  if (state.isA) {
    return (
      { balanceA: state.channelState.balanceA.add(toNano('0.2'))
      , balanceB: state.channelState.balanceB
      , seqnoA: state.channelState.seqnoA.add(new BN('1'))
      , seqnoB: state.channelState.seqnoB.add(new BN('1'))
      }
    )
  } else {
    return (
      { balanceA: state.channelState.balanceA
      , balanceB: state.channelState.balanceB.add(toNano('0.2'))
      , seqnoA: state.channelState.seqnoA.add(new BN('1'))
      , seqnoB: state.channelState.seqnoB.add(new BN('1'))
      }
    )
  }
}

function getChannelStateForLostRound() {
  if (state.isA) {
    return (
      { balanceA: state.channelState.balanceA
      , balanceB: state.channelState.balanceB.add(toNano('0.2'))
      , seqnoA: state.channelState.seqnoA.add(new BN('1'))
      , seqnoB: state.channelState.seqnoB.add(new BN('1'))
      }
    )
  } else {
    return (
      { balanceA: state.channelState.balanceA.add(toNano('0.2'))
      , balanceB: state.channelState.balanceB
      , seqnoA: state.channelState.seqnoA.add(new BN('1'))
      , seqnoB: state.channelState.seqnoB.add(new BN('1'))
      }
    )
  }
}

function serialize(data) {
  return TonWeb.utils.bytesToBase64(data)
}

function deserialize(data) {
  return TonWeb.utils.base64ToBytes(data)
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

function getData() {
  return state.channel.getData().catch(function(e) {
    console.log('error in getData:', e)
    return timeout(1000).then(getData)
  })
}

function getChannelState() {
  return state.channel.getChannelState().catch(function(e) {
    if (e.toString() === 'Error: http provider parse response error') {
      throw e
    } else {
      console.log('error in getChannelState:', e)
      return timeout(1000).then(getChannelState)
    }
  })
}

function getBalance(address) {
  return tonweb.getBalance(address).catch(function(e) {
    console.log('error in getBalance:', e)
    return timeout(1000).then(function() {
      return getBalance(address)
    })
  })
}

function deployChannel() {
  return state.fromWallet.deploy().send(toNano('0.05')).catch(function(e) {
    console.log('error in deployChannel:', e)
    return timeout(1000).then(deployChannel)
  })
}

function initChannel() {
  return state.fromWallet.init(state.channelState).send(toNano('0.05')).catch(function(e) {
    console.log('error in initChannel:', e)
    return timeout(1000).then(initChannel)
  })
}

function verifyClose(signature) {
  return state.channel.verifyClose(state.channelState, signature).catch(function(e) {
    console.log('error in verifyClose:', e)
    return timeout(1000).then(function() {
      return verifyClose(signature)
    })
  })
}

function closeChannel(signature) {
  return state.fromWallet.close(
    { ...state.channelState
    , hisSignature: signature
    }
  ).send(toNano('0.05')).catch(function (e) {
    console.log('error in closeChannel:', e)
    return timeout(1000).then(function() {
      return closeChannel(signature)
    })
  })
}

// Utility

function timeout(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}

function findOne(q) {
  return document.querySelector(q)
}

function hide(el) {
  el.style.display = 'none'
}

function hideAllPanes() {
  const divEls = document.querySelectorAll('main>div')
  divEls.forEach(function (divEl) {
    hide(divEl)
  })
}

function hideLoading() {
  const mainEl = findOne('body>main')
  mainEl.classList.remove('loading')
}

function showOnlyPane(el) {
  hideAllPanes()
  el.style.display = ''
}

function showError(msg) {
  const errorViewEl = findOne('#errorMessage')
  errorViewEl.innerText = msg
  errorViewEl.style.visibility = 'visible'
  setTimeout(hideError, 5000)
}

function hideError() {
  const errorViewEl = findOne('#errorMessage')
  errorViewEl.innerText = ' '
  errorViewEl.style.visibility = 'hidden'
}
