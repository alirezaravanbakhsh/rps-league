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
  }

// TonWeb
const BN = TonWeb.utils.BN
const toNano = TonWeb.utils.toNano
const fromNano = TonWeb.utils.fromNano
const providerUrl = 'https://testnet.toncenter.com/api/v2/jsonRPC'
const apiKey = '0b673465b3dff8f572d26adb553f2bdabcd894c19d7b74c8104d6b3fb56b00bc'
const tonweb = new TonWeb(new TonWeb.HttpProvider(providerUrl, {apiKey}))

hideAllPanes()
setupWebSocket()

function setupWebSocket() {
  const url = 'ws://' + location.host + '/myWebsocket'
  const wsServer = new WebSocket(url)
  state.wsServer = wsServer

  wsServer.onerror = function() {
    showError('Error connecting to websocket server.')
  }

  wsServer.onclose = function() {
    hideAllPanes()
    showError('Connection to websocket closed.')
  }

  wsServer.onopen = function() {
    showWalletPane()
    // wsServer.send(JSON.stringify({command: 'getAddress'}))
  }

  wsServer.onmessage = function(m) {
    const msg = JSON.parse(m.data)
    if (msg.event === 'waiting') {
      showWaitRoomPane()
    } else if (msg.event === 'joined') {
      const hisAddress = new TonWeb.utils.Address(msg.hisAddress)
      const hisPublicKey = deserialize(msg.hisPublicKey)
      setupChannel(msg.roomId, msg.isA, hisAddress, hisPublicKey)
    } else if (msg.event === 'picked') {
      gamePicked(msg.isA)
    } else if (msg.event === 'draw') {
      gameDraw(msg.pick)
    } else if (msg.event === 'won') {
      // state.channelState = deserializeChannelState(msg.channelState)
      gameWon(msg.pick)
    } else if (msg.event === 'lost') {
      gameLost(msg.pick)
    } else {
      console.log('unknown message: %o', msg)
    }
    // if (msg.event === 'error') {
    //   showError(msg.text)
    // } else if (msg.event === 'address') {
    //   setupWallet(msg.address, msg.publicKey)
    // } else if (msg.event === 'channelInitialized') {
    //   checkInitialized()
    // } else if (msg.event === 'closed') {
    //   wsServer.send(JSON.stringify({command: 'getAddress'}))
    // } else if (msg.event === 'left') {
    //   gameYourPickEl.innerText = ''
    //   gameTheirPickEl.innerText = ''
    //   showOnlyPane(hallViewEl)
    // }
  }
}

async function showWalletPane() {
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
  }
  const walletAddressEl = findOne('#walletAddress')
  walletAddressEl.innerText = state.address.toString(true, true, true)
  const walletPaneEl = findOne('#walletPane')
  showOnlyPane(walletPaneEl)
  refreshBalance()
}

async function refreshBalance() {
  balance = await tonweb.getBalance(state.address)
  state.balance = new BN(balance)
  const walletBalanceEl = findOne('#walletBalance')
  walletBalanceEl.innerText = fromNano(state.balance)
  state.timer = setTimeout(refreshBalance, 1000)
}

const playNowEl = findOne('#playNow')

playNowEl.addEventListener('click', function() {
  hideError()
  if (state.balance.gte(toNano('1.5'))) {
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
  const waitRoomPaneEl = findOne('#waitRoomPane')
  showOnlyPane(waitRoomPaneEl)
}

async function setupChannel(roomId, isA, hisAddress, hisPublicKey) {
  const createChannelPaneEl = findOne('#createChannelPane')
  showOnlyPane(createChannelPaneEl)
  state.roomId = roomId
  state.isA = isA
  const channelInitState =
    { balanceA: toNano('1')
    , balanceB: toNano('1')
    , seqnoA: new BN(0)
    , seqnoB: new BN(0)
    }
  state.channelState = channelInitState
  const channelConfig =
    { channelId: roomId
    , addressA: isA ? state.address : hisAddress
    , addressB: isA ? hisAddress : state.address
    , initBalanceA: channelInitState.balanceA
    , initBalanceB: channelInitState.balanceB
    }
  state.channel = tonweb.payments.createChannel(
    { ...channelConfig
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
  console.log('channel address: %s', channelAddress.toString(true, true, true))
  try {
    const s = await state.channel.getChannelState()
    console.log('channel exists, skipping creation')
  } catch (e) {
    if (isA) {
      await state.fromWallet.deploy().send(toNano('0.05'))
    }
    const waitForChannelCreation = function() {
      return state.channel.getChannelState().then(function(s) {
        console.log('channel creation state: %s', s)
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
  console.log('channel created')
  const data = await state.channel.getData()
  const initializingChannelPaneEl = findOne('#initializingChannelPane')
  showOnlyPane(initializingChannelPaneEl)
  if (isA && data.balanceA.toString() === '0') {
    await state.fromWallet
      .topUp({coinsA: channelInitState.balanceA, coinsB: new BN(0)})
      .send(channelInitState.balanceA.add(toNano('0.05')))
    const waitForTopUpA = function() {
      return state.channel.getData().then(function(data) {
        console.log('waiting for top-up')
        if (data.balanceA.toString() !== '0') {
          return
        } else {
          return timeout(1000).then(waitForTopUpA)
        }
      })
    }
    await waitForTopUpA()
  } else {
    await state.fromWallet
      .topUp({coinsA: new BN(0), coinsB: channelInitState.balanceB})
      .send(channelInitState.balanceB.add(toNano('0.05')))
    const waitForTopUpB = function() {
      return state.channel.getData().then(function(data) {
        console.log('waiting for top-up')
        if (data.balanceB.toString() !== '0') {
          return
        } else {
          return timeout(1000).then(waitForTopUpB)
        }
      })
    }
    await waitForTopUpB()
  }
  if (!isA) {
    await state.fromWallet.init(channelInitState).send(toNano('0.05'))
  }
  const waitForChannelInit = function() {
    return state.channel.getChannelState().then(function(s) {
      console.log('channel init state: %s', s)
      if (s === 1) {
        return
      } else {
        return timeout(1000).then(waitForChannelInit)
      }
    })
  }
  await waitForChannelInit()
  startGame()
  // state.wsServer.send(JSON.stringify({
  //   command: 'initChannel',
  //   balanceA: channelInitState.balanceA.toString(),
  //   balanceB: channelInitState.balanceB.toString(),
  //   channelId: channelConfig.channelId.toString(),
  //   addressB: state.addressB.toString(true, true, true),
  //   publicKeyB: TonWeb.utils.bytesToBase64(state.keyPair.publicKey)
  // }))
  // waitForInit()
}

// async function waitForInit() {
//   showOnlyPane(initChannelViewEl)
// }

// async function checkInitialized() {
//   const data = await state.channelB.getData()
//   console.log(data)
//   console.log('balanceA: %s', data.balanceA.toString())
//   console.log('balanceB: %s', data.balanceB.toString())
//   x = await state.fromWalletB.init(state.channelInitState).send(toNano('0.05'))
//   console.log('x: %o', x)
//   let i = 30
//   while (i > 0) {
//     i -= 1
//     try {
//       const channelState = await state.channelB.getChannelState()
//       console.log('channel state: %s', channelState)
//       if (channelState !== 0) {
//         break
//       }
//     } catch (e) {
//     }
//     await timeout(1000)
//   }
//   showOnlyPane(hallViewEl)
//   showChannelBalance()
//   hideError()
// }

// hallJoinEl.addEventListener('click', function() {
//   state.wsServer.send(JSON.stringify({command: 'join'}))
// })

// hallExitEl.addEventListener('click', function() {
//   state.channelB.signClose(state.channelState)
//   .then(function(signatureCloseB){
//     state.wsServer.send(JSON.stringify({
//       command: 'exit',
//       signatureCloseB: serializeSignature(signatureCloseB)
//     }))
//   })
// })

// waitLeaveEl.addEventListener('click', function() {
//   state.wsServer.send(JSON.stringify({command: 'leave'}))
// })

// gameLeaveEl.addEventListener('click', function() {
//   state.wsServer.send(JSON.stringify({command: 'leave'}))
// })

async function startGame() {
  const gamePaneEl = findOne('#gamePane')
  const gameRoomEl = findOne('#gameRoom')
  const gameLeaveEl = findOne('#gameLeave')
  const gamePickREl = findOne('#gamePickR')
  const gamePickPEl = findOne('#gamePickP')
  const gamePickSEl = findOne('#gamePickS')
  const gameYourPickEl = findOne('#gameYourPick')
  const gameDrawEl = findOne('#gameDraw')
  const gameWonEl = findOne('#gameWon')
  const gameLostEl = findOne('#gameLost')
  showOnlyPane(gamePaneEl)
  clearResult()
  showChannelBalance()
  gameRoomEl.innerText = state.roomId
  gamePickREl.addEventListener('click', function() {
    disablePickButtons()
    gameYourPickEl.innerText = icon('r')
    const nextChannelState = getChannelStateForNextRound()
    state.channel.signState(nextChannelState).then(function(signature) {
      state.wsServer.send(JSON.stringify(
        { command: 'pick'
        , pick: 'r'
        // , nextChannelState: serializeChannelState(nextChannelState)
        , signature: serialize(signature)
        }
      ))
      state.channelState = nextChannelState
      showChannelBalance()
    })
  })
  gamePickPEl.addEventListener('click', function() {
    disablePickButtons()
    gameYourPickEl.innerText = icon('p')
    const nextChannelState = getChannelStateForNextRound()
    state.channel.signState(nextChannelState).then(function(signature) {
      state.wsServer.send(JSON.stringify(
        { command: 'pick'
        , pick: 'p'
        // , nextChannelState: serializeChannelState(nextChannelState)
        , signature: serialize(signature)
        }
      ))
      state.channelState = nextChannelState
      showChannelBalance()
    })
  })
  gamePickSEl.addEventListener('click', function() {
    disablePickButtons()
    gameYourPickEl.innerText = icon('s')
    const nextChannelState = getChannelStateForNextRound()
    state.channel.signState(nextChannelState).then(function(signature) {
      state.wsServer.send(JSON.stringify(
        { command: 'pick'
        , pick: 's'
        // , nextChannelState: serializeChannelState(nextChannelState)
        , signature: serialize(signature)
        }
      ))
      state.channelState = nextChannelState
      showChannelBalance()
    })
  })
}

function showChannelBalance() {
  const channelBalanceEl = findOne('#channelBalance')
  channelBalanceEl.innerText = fromNano(
    state.isA ? state.channelState.balanceA : state.channelState.balanceB
  )
}

function gamePicked(isA) {
  const gameTheirPickEl = findOne('#gameTheirPick')
  if (isA != state.isA) {
    gameTheirPickEl.innerText = '☑️'
  }
}

function gameDraw(pick) {
  state.channelState = getChannelStateForPreviousRound()
  const gameTheirPickEl = findOne('#gameTheirPick')
  gameTheirPickEl.innerText = icon(pick)
  showResult('draw')
  showChannelBalance()
  setTimeout(function() {
    clearResult()
    enablePickButtons()
  }, 2000)
}

function gameWon(pick) {
  state.channelState = getChannelStateForWonRound()
  const gameTheirPickEl = findOne('#gameTheirPick')
  gameTheirPickEl.innerText = icon(pick)
  showResult('won')
  showChannelBalance()
  setTimeout(function() {
    clearResult()
    enablePickButtons()
  }, 2000)
}

function gameLost(pick) {
  state.channelState = getChannelStateForLostRound()
  const gameTheirPickEl = findOne('#gameTheirPick')
  gameTheirPickEl.innerText = icon(pick)
  showResult('lost')
  showChannelBalance()
  setTimeout(function() {
    clearResult()
    enablePickButtons()
  }, 2000)
}

function getChannelStateForNextRound() {
  if (state.isA) {
    return (
      { balanceA: state.channelState.balanceA.sub(toNano('0.1'))
      , balanceB: state.channelState.balanceB
      , seqnoA: state.channelState.seqnoA.add(new BN('1'))
      , seqnoB: state.channelState.seqnoB
      }
    )
  } else {
    return (
      { balanceA: state.channelState.balanceA
      , balanceB: state.channelState.balanceB.sub(toNano('0.1'))
      , seqnoA: state.channelState.seqnoA
      , seqnoB: state.channelState.seqnoB.add(new BN('1'))
      }
    )
  }
}

function getChannelStateForPreviousRound() {
  if (state.isA) {
    return (
      { balanceA: state.channelState.balanceA.add(toNano('0.1'))
      , balanceB: state.channelState.balanceB
      , seqnoA: state.channelState.seqnoA.sub(new BN('1'))
      , seqnoB: state.channelState.seqnoB
      }
    )
  } else {
    return (
      { balanceA: state.channelState.balanceA
      , balanceB: state.channelState.balanceB.add(toNano('0.1'))
      , seqnoA: state.channelState.seqnoA
      , seqnoB: state.channelState.seqnoB.sub(new BN('1'))
      }
    )
  }
}

function getChannelStateForWonRound() {
  if (state.isA) {
    return (
      { balanceA: state.channelState.balanceA.add(toNano('0.2'))
      , balanceB: state.channelState.balanceB.sub(toNano('0.1'))
      , seqnoA: state.channelState.seqnoA.add(new BN('1'))
      , seqnoB: state.channelState.seqnoB.add(new BN('1'))
      }
    )
  } else {
    return (
      { balanceA: state.channelState.balanceA.sub(toNano('0.1'))
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

// gamePickREl.addEventListener('click', function() {
//   disablePickButtons()
//   gameYourPickEl.innerText = icon('r')
//   const nextChannelState = getChannelStateForNextRound()
//   state.channelB.signState(nextChannelState).then(function(signatureB) {
//     state.wsServer.send(JSON.stringify({
//       command: 'pick',
//       pick: 'r',
//       nextChannelState: serializeChannelState(nextChannelState),
//       signatureB: serializeSignature(signatureB)
//     }))
//     state.channelState = nextChannelState
//     showChannelBalance()
//   })
// })

// gamePickPEl.addEventListener('click', function() {
//   disablePickButtons()
//   gameYourPickEl.innerText = icon('p')
//   const nextChannelState = getChannelStateForNextRound()
//   state.channelB.signState(nextChannelState).then(function(signatureB) {
//     state.wsServer.send(JSON.stringify({
//       command: 'pick',
//       pick: 'p',
//       nextChannelState: serializeChannelState(nextChannelState),
//       signatureB: serializeSignature(signatureB)
//     }))
//     state.channelState = nextChannelState
//     showChannelBalance()
//   })
// })

// gamePickSEl.addEventListener('click', function() {
//   disablePickButtons()
//   gameYourPickEl.innerText = icon('s')
//   const nextChannelState = getChannelStateForNextRound()
//   state.channelB.signState(nextChannelState).then(function(signatureB) {
//     state.wsServer.send(JSON.stringify({
//       command: 'pick',
//       pick: 's',
//       nextChannelState: serializeChannelState(nextChannelState),
//       signatureB: serializeSignature(signatureB)
//     }))
//     state.channelState = nextChannelState
//     showChannelBalance()
//   })
// })

// function serializeChannelState(channelState) {
//   return {
//     balanceA: channelState.balanceA.toString(),
//     balanceB: channelState.balanceB.toString(),
//     seqnoA: channelState.seqnoA.toString(),
//     seqnoB: channelState.seqnoB.toString()
//   }
// }

// function deserializeChannelState(channelState) {
//   return {
//     balanceA: new BN(channelState.balanceA),
//     balanceB: new BN(channelState.balanceB),
//     seqnoA: new BN(channelState.seqnoA),
//     seqnoB: new BN(channelState.seqnoB)
//   }
// }

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
  const gamePickREl = findOne('#gamePickR')
  const gamePickPEl = findOne('#gamePickP')
  const gamePickSEl = findOne('#gamePickS')
  gamePickREl.disabled = true
  gamePickPEl.disabled = true
  gamePickSEl.disabled = true
}

function enablePickButtons() {
  const gamePickREl = findOne('#gamePickR')
  const gamePickPEl = findOne('#gamePickP')
  const gamePickSEl = findOne('#gamePickS')
  gamePickREl.disabled = false
  gamePickPEl.disabled = false
  gamePickSEl.disabled = false
}

function showResult(r) {
  const gameDrawEl = findOne('#gameDraw')
  const gameWonEl = findOne('#gameWon')
  const gameLostEl = findOne('#gameLost')
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
  const gameYourPickEl = findOne('#gameYourPick')
  const gameTheirPickEl = findOne('#gameTheirPick')
  const gameDrawEl = findOne('#gameDraw')
  const gameWonEl = findOne('#gameWon')
  const gameLostEl = findOne('#gameLost')
  gameDrawEl.style.display = 'none'
  gameWonEl.style.display = 'none'
  gameLostEl.style.display = 'none'
  gameYourPickEl.innerText = ''
  gameTheirPickEl.innerText = ''
  enablePickButtons()
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

function showOnlyPane(el) {
  hideAllPanes()
  el.style.display = ''
}

function showError(msg) {
  const errorViewEl = findOne('#errorMessage')
  errorViewEl.innerText = msg
  errorViewEl.style.visibility = 'visible'
  setTimeout(hideError, 3000)
}

function hideError() {
  const errorViewEl = findOne('#errorMessage')
  errorViewEl.innerText = ' '
  errorViewEl.style.visibility = 'hidden'
}
