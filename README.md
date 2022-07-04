# rps-league

## Motivation

[TON Contests](https://t.me/toncontests) run an event (called **Hack-a-TON**) during 1st-3rd July, 2022. It gathers interested developers to work on a new technology, called **TON Payment**, or **Payment Channels**. This simple project is implemented to learn about this insteresting technology more deep.

## What does it do?

This project lets users play the popular Rock-Paper-Scissors game with others. They must top-up some TONs (at least 1 TON) to enter the game. On every round, the loser pays 0.1 TON to the winner. The game will end when a player leaves the game, or at least one player loses all his/her top-upped TONs.

The Rock-Paper-Scissors rule is as follows:

| Picks | Result |
|:--------:|:-----:|
|Paper 🖐 vs. Rock ✊ | Paper 🖐 wins |
|Rock ✊ vs. Scissors ✌️ |  Rock ✊ wins |
|Scissors ✌️ vs. Paper 🖐 | Scissors ✌️ wins|
|||
|Rock ✊ vs. Rock ✊ | Draw |
|Paper 🖐 vs. Paper 🖐 | Draw|
|Scissors ✌️ vs. Scissors ✌️ |  Draw|

## How does it work?

The service is run on [testnet](https://testnet.toncenter.com/) and players need to have TONs on this network. The coins can be obtained from [@testgiver_ton_bot](https://t.me/testgiver_ton_bot).

When player comes in, his/her balance will be shown. Player can top-up and increase the balance by sending some TONs to the deposit address shown in the page (as mentioned, the payment is under *testnet* network). When the balance is more than 1 TON, player can start the game. Server will then assign a player who is waiting for a match (if there is any). when 2 players joined by the server, the game is started and every player should pick hisr/her choice (Rock ✊, Paper 🖐 or Scissors ✌️). As soon as both players pick their own choice, server will evaluate the round result, gets 0.1 TON from loser and pays it to winner (if the round is not 'Draw').

Technically, the top-up amounts will be transfered on-net to the internal wallet, and a channel is initiated between 2 players. All round-paymeents are done off-net in the channel. Finally, when the game is end, the players balance will be backed to their wallet and can be used in next games.

## How to install?

Check if you have Nodejs installed on your machine by using `node -v` and `npm -v`.

If they are not installed, install the latest version of Nodejs. You can google it depends on your using OS.

Get the project `git clone git@github.com:alirezaravanbakhsh/rps-league.git`.

## How to Run?

In a command line shell, go to the root directory of project, and execute `node server.js`. The service will be run on port 3000 (if not occupied).

In a browser, navigate to `localhost:3000` (reeplace localhost by the server's IP if the server is running on a different machin than running the browser). To play as different players, you need to do the same on *different devices* or:

- using different brands of browser: e.g. chrome, firefox, safari
- using incognito mode of browser (if it supports)
