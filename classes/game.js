// server-side game logic for a texas hold 'em game
const Deck = require('./deck.js');
const Player = require('./player.js');
const Hand = require('pokersolver').Hand;

const Game = function (name, host) {
  this.deck = new Deck();
  this.host = host;
  this.players = [];
  this.status = 0;
  this.cardsPerPlayer = 2;
  this.currentlyPlayed = 0;
  this.gameWinner = null;
  this.gameName = name;
  this.roundNum = 0;
  this.roundData = {
    dealer: 0,
    bigBlind: '',
    smallBlind: '',
    turn: '',
    bets: [],
  };
  this.community = [];
  this.foldPot = 0;
  this.bigBlindWent = false;
  this.smokeScreenActive = false;
  this.lastMoveParsed = { move: '', player: '' };
  this.roundInProgress = false;
  this.disconnectedPlayers = [];
  this.autoBuyIns = true;
  this.debug = false;
  this.smallBlind = 1;
  this.bigBlind = 2;

  const constructor = (function () {})(this);

  this.log = () => {
    if (this.debug) {
      console.log(...arguments);
    }
  };

  this.assignBlind = () => {
    const activePlayers = this.players.filter(p => !p.waiting);
    if (activePlayers.length === 0) return;

    this.roundData.smallBlind =
      this.roundData.dealer + 1 < activePlayers.length
        ? this.roundData.dealer + 1
        : 0;
    this.roundData.bigBlind =
      this.roundData.smallBlind + 1 < activePlayers.length
        ? this.roundData.smallBlind + 1
        : 0;

    this.log('smallBlind: ' + this.roundData.smallBlind);
    this.log('bigBlind: ' + this.roundData.bigBlind);

    for (let i = 0; i < this.players.length; i++) {
      this.players[i].setDealer(false);
      this.players[i].setBlind('');
      this.players[i].setStatus('');
    }

    for (let i = 0; i < activePlayers.length; i++) {
      activePlayers[i].setDealer(i === this.roundData.dealer);
      if (i === this.roundData.bigBlind) {
        activePlayers[i].setBlind('Big Blind');
      } else if (i === this.roundData.smallBlind) {
        activePlayers[i].setBlind('Small Blind');
      } else if (i === this.roundData.dealer) {
        activePlayers[i].setBlind('Dealer');
      }
    }

    const goFirstIndex =
      this.roundData.bigBlind + 1 < activePlayers.length
        ? this.roundData.bigBlind + 1
        : 0;
    this.roundData.turn = activePlayers[goFirstIndex].getUsername();
    activePlayers[goFirstIndex].setStatus('Their Turn');
  };

  this.startNewRound = () => {
    // Clean up players pending exit from previous round
    const exitPlayers = this.players.filter(p => p.pendingExit);
    for (const p of exitPlayers) {
      this.broadcastLog(`${p.getUsername()} has left the game.`);
    }
    this.players = this.players.filter(p => !p.pendingExit);
    
    // Transition all waiting players to active
    for (const p of this.players) {
      if (p.waiting) {
        p.waiting = false;
        this.broadcastLog(`${p.getUsername()} is now joining the game.`);
      }
    }

    if (this.players.length === 0) {
      this.roundInProgress = false;
      return;
    }

    this.lastMoveParsed = { move: '', player: '' };
    this.roundInProgress = true;
    this.foldPot = 0;
    this.bigBlindWent = false;
    this.community = [];
    this.roundData.turn = '';
    this.roundData.bets = [];
    this.smokeScreenActive = false;
    for (const p of this.players) {
      p.skillUsed = false;
      p.isSilenced = false;
      p.revealed = false;
    }
    this.assignSkills();
    this.dealCards();
    this.log('deck len' + this.deck.cards.length);
    for (pn of this.players) {
      pn.allIn = false;
    }

    // Init dealer
    const activePlayers = this.players.filter(p => !p.waiting);
    if (this.roundNum == 0) {
      this.roundData.dealer = 0;
    } else {
      this.roundData.dealer =
        this.roundData.dealer + 1 < activePlayers.length
          ? this.roundData.dealer + 1
          : 0;
    }
    // Init blind and first player
    this.assignBlind();

    if (this.autoBuyIns) {
      for (player of activePlayers) {
        if (player.getMoney() == 0) {
          player.money = 100;
          player.buyIns = player.buyIns + 1;
        }
      }
    }

    // handle big and small blind initial forced bets
    const bbPlayer = activePlayers[this.roundData.bigBlind];
    const sbPlayer = activePlayers[this.roundData.smallBlind];

    if (bbPlayer.money < this.bigBlind) {
      bbPlayer.money = 0;
      bbPlayer.allIn = true;
      this.roundData.bets.push([
        {
          player: bbPlayer.getUsername(),
          bet: this.bigBlind - bbPlayer.money,
        },
      ]);
    } else {
      bbPlayer.money =
        bbPlayer.money - this.bigBlind;
      this.roundData.bets.push([
        {
          player: bbPlayer.getUsername(),
          bet: this.bigBlind,
        },
      ]);
    }

    if (sbPlayer.money == this.smallBlind) {
      sbPlayer.money = 0;
      this.roundData.bets[0].push({
        player: sbPlayer.getUsername(),
        bet: this.smallBlind - bbPlayer.money,
      });
      sbPlayer.allIn = true;
    } else {
      sbPlayer.money =
        sbPlayer.money - this.smallBlind;
      this.roundData.bets[0].push({
        player: sbPlayer.getUsername(),
        bet: this.smallBlind,
      });
    }

    this.roundNum++;
    this.broadcastLog(`<b>Round ${this.roundNum} started.</b> Stage: ${this.getStageName()}`);
    this.rerender();
  };

  this.rerender = () => {
    let playersData = [];
    for (let i = 0; i < this.getNumPlayers(); i++) {
      playersData.push({
        username: this.players[i].getUsername(),
        status: this.players[i].getStatus(),
        blind: this.players[i].getBlind(),
        money: this.smokeScreenActive ? '???' : this.players[i].getMoney(),
        spirituality: this.players[i].spirituality,
        buyIns: this.players[i].buyIns,
        isChecked: this.playerIsChecked(this.players[i]),
        away: this.players[i].away,
        waiting: this.players[i].waiting,
        allIn: (this.smokeScreenActive && this.roundInProgress) ? false : this.players[i].allIn,
        isSilenced: this.players[i].isSilenced,
        revealed: this.players[i].revealed,
        cards: this.players[i].revealed ? this.players[i].cards : null,
        skillUsed: this.players[i].skillUsed,
      });
    }
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      let visibleBets = this.roundData.bets;
      if (this.smokeScreenActive) {
        visibleBets = this.roundData.bets.map(stage => stage.map(b => ({ ...b, bet: b.bet === 'Fold' ? 'Fold' : '???' })));
      }

      this.players[pn].emit('rerender', {
        community: this.community,
        topBet: this.smokeScreenActive ? '???' : this.getCurrentTopBet(),
        bets: visibleBets,
        username: this.players[pn].getUsername(),
        round: this.roundNum,
        stage: this.getStageName(),
        pot: this.smokeScreenActive ? '???' : this.getCurrentPot(),
        players: playersData,
        myMoney: this.players[pn].getMoney(),
        myBet: this.getPlayerBetInStage(this.players[pn]),
        myStatus: this.players[pn].getStatus(),
        myBlind: this.players[pn].getBlind(),
        mySpirituality: this.players[pn].spirituality,
        mySkill: this.players[pn].assignedSkill,
        skillUsed: this.players[pn].skillUsed,
        roundInProgress: this.roundInProgress,
        buyIns: this.players[pn].buyIns,
        away: this.players[pn].away,
        waiting: this.players[pn].waiting,
      });
    }
  };

  this.getCurrentPot = () => {
    if (this.roundData.bets == undefined || this.roundData.bets.length == 0)
      return 0;
    else {
      let sum = 0;
      for (let i = 0; i < this.roundData.bets.length; i++) {
        sum += this.roundData.bets[i].reduce(
          (acc, curr) =>
            curr.bet != 'Buy-in' && curr.bet != 'Fold'
              ? acc + curr.bet
              : acc + 0,
          0
        );
      }
      return this.foldPot + sum;
    }
  };

  this.getPlayerBetInStage = (player) => {
    if (
      this.roundData.bets == undefined ||
      this.roundData.bets.length == 0 ||
      this.getCurrentRoundBets() == undefined
    )
      return 0;
    const stageData = this.getCurrentRoundBets();
    let totalBetInStage = 0;

    for (let j = 0; j < stageData.length; j++) {
      if (
        stageData[j].player == player.getUsername() &&
        stageData[j].bet != 'Buy-in' &&
        stageData[j].bet != 'Fold'
      ) {
        totalBetInStage += stageData[j].bet;
        break;
      }
    }
    return totalBetInStage;
  };

  this.getCurrentTopBet = () => {
    if (this.roundData.bets == undefined || this.roundData.bets.length == 0)
      return 0;
    else {
      let maxBet = 0;
      for (let i = 0; i < this.players.length; i++) {
        maxBet = Math.max(maxBet, this.getPlayerBetInStage(this.players[i]));
      }
      return maxBet;
    }
  };

  this.getStageName = () => {
    if (this.roundData.bets.length == 1) {
      return 'Pre-Flop';
    } else if (this.roundData.bets.length == 2) {
      return 'Flop';
    } else if (this.roundData.bets.length == 3) {
      return 'Turn';
    } else if (this.roundData.bets.length == 4) {
      return 'River';
    } else {
      return 'Error';
    }
  };

  this.playerIsChecked = (playr) => {
    if (this.roundData.bets) {
      const bets = this.getCurrentRoundBets() || [];
      return bets.some((a) => a.player == playr.getUsername() && a.bet == 0);
    }
  };

  this.findFirstToGoPlayer = () => {
    const activePlayers = this.players.filter(p => !p.waiting);
    if (
      !activePlayers[this.roundData.smallBlind] ||
      activePlayers[this.roundData.smallBlind].getStatus() == 'Fold' ||
      activePlayers[this.roundData.smallBlind].allIn
    ) {
      let index = this.roundData.smallBlind;
      do {
        index = index + 1 >= activePlayers.length ? 0 : index + 1;
      } while (
        activePlayers[index].getStatus() == 'Fold' ||
        activePlayers[index].allIn
      );
      return index;
    } else {
      return this.roundData.smallBlind;
    }
  };

  this.getNonFoldedPlayer = () => {
    let numNonFolds = 0;
    let nonFolderPlayer;
    for (let i = 0; i < this.getNumPlayers(); i++) {
      if (this.players[i].getStatus() != 'Fold') {
        numNonFolds++;
        nonFolderPlayer = this.players[i];
      }
    }
    return [numNonFolds, nonFolderPlayer];
  };

  this.updateStage = () => {
    const activePlayers = this.players.filter(p => !p.waiting);
    const firstToGoIndex = this.findFirstToGoPlayer();
    const firstToGoPlayer = activePlayers[firstToGoIndex];
    
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].waiting) continue;

      if (
        this.players[i] === firstToGoPlayer &&
        this.players[i].getStatus() !== 'Fold'
      ) {
        this.players[i].setStatus('Their Turn');
      } else if (this.players[i].getStatus() !== 'Fold') {
        this.players[i].setStatus('');
      }
    }
    this.roundData.bets.push([]);
    this.smokeScreenActive = false;
    this.broadcastLog(`<b>Stage: ${this.getStageName()}</b> (Pot: $${this.getCurrentPot()})`);
  };

  this.moveOntoNextPlayer = () => {
    let handOver = false;
    if (this.isStageComplete()) {
      this.log('stage complete');
      const activePlayers = this.players.filter(p => !p.waiting);
      if (this.allPlayersAllIn()) {
        this.log(' all players all in');
        if (this.roundData.bets.length == 1) {
          this.community.push(this.deck.dealRandomCard());
          this.community.push(this.deck.dealRandomCard());
          this.community.push(this.deck.dealRandomCard());
          this.roundData.bets.push([]);
        }
        if (this.roundData.bets.length == 2) {
          this.community.push(this.deck.dealRandomCard());
          this.roundData.bets.push([]);
        }
        if (this.roundData.bets.length == 3) {
          this.community.push(this.deck.dealRandomCard());
          this.roundData.bets.push([]);
        }
        this.rerender();
      }
      // stage-by-stage logic.
      // check if everyone folded but one
      const [numNonFolds, nonFolderPlayer] = this.getNonFoldedPlayer();
      if (numNonFolds == 1) {
        // everyone folded, start new round, give pot to player
        this.log('everyone folded except one');
        nonFolderPlayer.money = this.getCurrentPot() + nonFolderPlayer.money;
        this.endHandAllFold(nonFolderPlayer.getUsername());
        handOver = true;
      } else {
        if (this.roundData.bets.length == 1) {
          this.community.push(this.deck.dealRandomCard());
          this.community.push(this.deck.dealRandomCard());
          this.community.push(this.deck.dealRandomCard());
          this.updateStage();
        } else if (this.roundData.bets.length == 2) {
          this.community.push(this.deck.dealRandomCard());
          this.updateStage();
        } else if (this.roundData.bets.length == 3) {
          this.community.push(this.deck.dealRandomCard());
          this.updateStage();
        } else if (this.roundData.bets.length == 4) {
          handOver = true;
          const roundResults = this.evaluateWinners();
          for (playerResult of roundResults.playersData) {
            const suitMap = { 's': '♠', 'h': '♥', 'd': '♦', 'c': '♣' };
            const formattedCards = playerResult.hand.cards.map(c => c.value + (suitMap[c.suit] || c.suit)).join(' ');
            playerResult.player.setStatus(`${playerResult.hand.name} (${formattedCards})`);
          }
          const winningData = this.distributeMoney(roundResults);
          this.calculateSpirituality(winningData);
          this.revealCards(winningData.filter((a) => a.winner));
        } else {
          this.log('This stage of the round is INVALID!!');
        }
      }
    } else {
      this.log('stage not complete');
      //check if everyone folded except one player
      const [numNonFolds, nonFolderPlayer] = this.getNonFoldedPlayer();
      if (!handOver && numNonFolds == 1) {
        // everyone folded, start new round, give pot to player
        this.log('everyone folded except one');
        nonFolderPlayer.money = this.getCurrentPot() + nonFolderPlayer.money;
        this.endHandAllFold(nonFolderPlayer.getUsername());
        handOver = true;
      } else {
        let currTurnIndex = 0;
        //check if move just made was a fold
        if (this.lastMoveParsed.move == 'Fold') {
          currTurnIndex = this.players.findIndex(
            (p) => p === this.lastMoveParsed.player
          );
          this.lastMoveParsed = { move: '', player: '' };
        } else {
          currTurnIndex = this.players.findIndex(
            (p) => p.getStatus() === 'Their Turn'
          );
          if (currTurnIndex !== -1) {
            this.players[currTurnIndex].setStatus('');
          } else {
            // If no one has turn (e.g. after some state issues), find someone to give turn
            currTurnIndex = 0;
          }
        }
        let count = 0;
        do {
          currTurnIndex = currTurnIndex + 1 >= this.players.length ? 0 : currTurnIndex + 1;
          count ++;
        } while (
          (this.players[currTurnIndex].getStatus() == 'Fold'
          || this.players[currTurnIndex].allIn
          || this.players[currTurnIndex].waiting)
          && count < Object.keys(this.players).length * 2 // Avoid infinite loop, allow search twice on all players
        );
        this.players[currTurnIndex].setStatus('Their Turn');

        // Auto-fold for away players
        if (this.players[currTurnIndex].away) {
          this.log(`Player ${this.players[currTurnIndex].getUsername()} is away, auto-folding...`);
          setTimeout(() => {
            this.fold({ id: this.players[currTurnIndex].socket.id });
          }, 500);
        }
      }
    }
    if (!handOver) {
      this.log('RERENDERING');
      this.rerender();
    }
  };

  this.getPlayerBetInStageNum = (player, stageNum) => {
    if (
      this.roundData.bets == undefined ||
      this.roundData.bets.length == 0 ||
      this.roundData.bets[stageNum - 1] == undefined
    )
      return 0;
    const stageData = this.roundData.bets[stageNum - 1];
    let totalBetInStage = 0;

    for (let j = 0; j < stageData.length; j++) {
      if (
        stageData[j].player == player.getUsername() &&
        stageData[j].bet != 'Buy-in' &&
        stageData[j].bet != 'Fold'
      )
        totalBetInStage += stageData[j].bet;
    }
    return totalBetInStage;
  };

  this.getTotalBetsInStageNum = (stageNum) => {
    if (
      this.roundData.bets == undefined ||
      this.roundData.bets.length == 0 ||
      this.roundData.bets[stageNum - 1] == undefined
    )
      return 0;
    const stageData = this.roundData.bets[stageNum - 1];
    let totalBetInStage = 0;

    for (let j = 0; j < stageData.length; j++) {
      if (stageData[j].bet != 'Buy-in' && stageData[j].bet != 'Fold')
        totalBetInStage += stageData[j].bet;
    }
    return totalBetInStage;
  };

  this.getTotalInvested = (player) => {
    return (
      this.getPlayerBetInStageNum(player, 1) +
      this.getPlayerBetInStageNum(player, 2) +
      this.getPlayerBetInStageNum(player, 3) +
      this.getPlayerBetInStageNum(player, 4)
    );
  };

  this.calculateMoney = (winnerPot, players) => {
    let playerInvestments = [...players];
    while (playerInvestments.length > 1) {
      const sortedByInvested = playerInvestments.sort((a, b) =>
        a.invested < b.invested ? -1 : 1
      );
      const minStack = sortedByInvested[0].invested;
      winnerPot += minStack * playerInvestments.length;
      for (p of playerInvestments) {
        p.invested -= minStack;
      }
      const sortedByHandStrength = playerInvestments.sort((a, b) =>
        a.handStrength > b.handStrength ? -1 : 1
      );
      const maxHand = sortedByHandStrength[0].handStrength;
      const winners = playerInvestments.filter(
        (p) => p.handStrength === maxHand && p.live
      );
      for (p of winners) {
        p.result += winnerPot / winners.length;
      }
      playerInvestments = playerInvestments.filter((p) => p.invested > 0);
      winnerPot = 0;
    }

    if (playerInvestments.length === 1) {
      let p = playerInvestments[0];
      p.result += winnerPot + p.invested;
    }
  };

  this.distributeMoney = (result) => {
    let playerInvestments = this.players.map((p) => {
      const winData = result.winnerData.find((w) => w.player === p);
      const invested = this.getTotalInvested(p);
      return {
        player: p,
        invested: invested,
        originalInvested: invested,
        handStrength: winData ? winData.rank : -1,
        result: -invested,
        live: p.getStatus() !== 'Fold',
        winner: false,
        gain: 0,
      };
    });
    let pot = this.foldPot;
    this.calculateMoney(pot, playerInvestments);

    for (p of playerInvestments) {
      p.gain = p.originalInvested + p.result;
      p.player.money += p.gain;
      if (p.gain > 0) {
        p.winner = true;
        this.broadcastLog(`<b>${p.player.getUsername()} won $${p.gain.toFixed(2)}</b> (Net: ${p.result.toFixed(2)})`);
      }
    }

    // SYZOJ Rating Integration
    (async () => {
      try {
        const RatingCalculation = syzoj.model('rating_calculation');
        const RatingHistory = syzoj.model('rating_history');
        const User = syzoj.model('user');
        const winnerHands = {};
        for (const winner of result.winnerData) {
          winnerHands[winner.player.getUsername()] = winner.handTitle;
        }
        
        // Multiplier: 10
        const MULTIPLIER = 10;

        const calc = await RatingCalculation.create({
          poker_name: `poker game: Showdown`
        });
        await calc.save();

        for (const p of playerInvestments) {
          const user = await User.fromName(p.player.getUsername());
          if (!user) continue;

          const change = Math.round(p.result * MULTIPLIER);
          user.rating = (user.rating || 0) + change;
          await user.save();

          const history = await RatingHistory.create({
            rating_calculation_id: calc.id,
            user_id: user.id,
            rating_after: user.rating,
            rank: p.winner ? 1 : 2,
            poker_hand: p.winner ? winnerHands[p.player.getUsername()] || p.player.getStatus() : p.player.getStatus()
          });
          await history.save();
        }
      } catch (err) {
        console.error(`Failed to update poker rating: ${err.message}`);
      }
    })();

    return playerInvestments;
  };

  this.evaluateWinners = () => {
    let handArray = [];
    let playerArray = [];
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].getStatus() != 'Fold') {
        let h = Hand.solve(
          this.convertCardsFormat(this.players[i].cards.concat(this.community))
        );
        handArray.push(h);
        playerArray.push({ player: this.players[i], hand: h });
      }
    }
    const winners = Hand.winners(handArray);

    let winnerData = [];
    if (Array.isArray(winners)) {
      for (playerHand of playerArray) {
        for (winner of winners) {
          let winnerArray = winner.toString().split(', ');
          if (
            this.arraysEqual(playerHand.hand.cards.sort(), winnerArray.sort())
          ) {
            winnerData.push({
              player: playerHand.player,
              rank: playerHand.hand.rank,
              handTitle: playerHand.hand.name,
            });
            break;
          }
        }
      }
    } else {
      this.log('fatal error: winner cannot be calculated');
    }
    const res = { winnerData: winnerData, playersData: playerArray };
    return res;
  };

  this.arraysEqual = (a, b) => {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length != b.length) return false;

    for (let i = 0; i < a.length; ++i) {
      if (a[i] != b[i]) return false;
    }
    return true;
  };

  this.convertCardsFormat = (arr) => {
    let res = [];
    for (let i = 0; i < arr.length; i++) {
      let str = '';
      let value = arr[i].getValue();
      let suit = arr[i].getSuit();
      if (value == 10) {
        str += 'T';
      } else {
        str += value.toString();
      }
      if (suit == '♠') str += 's';
      else if (suit == '♥') str += 'h';
      else if (suit == '♦') str += 'd';
      else if (suit == '♣') str += 'c';
      res.push(str);
    }
    return res;
  };

  this.endHandAllFold = (username) => {
    this.log('endhandallfold' + this.players);
    this.roundInProgress = false;
    
    // SYZOJ Rating Integration for all-fold case
    (async () => {
      try {
        const [numNonFolds, nonFolderPlayer] = this.getNonFoldedPlayer();
        if (!nonFolderPlayer) return;

        const RatingCalculation = syzoj.model('rating_calculation');
        const RatingHistory = syzoj.model('rating_history');
        const User = syzoj.model('user');
        const MULTIPLIER = 10;
        const pot = this.getCurrentPot();

        const calc = await RatingCalculation.create({ poker_name: `poker game: Folds` });
        await calc.save();

        // Winner (Non-folder)
        const winnerUser = await User.fromName(nonFolderPlayer.getUsername());
        const totalInvestedByOthers = this.players
          .filter(p => p !== nonFolderPlayer)
          .reduce((sum, p) => sum + this.getTotalInvested(p), 0);
        
        const winnerGain = Math.round(totalInvestedByOthers * MULTIPLIER);

        this.broadcastLog(`<b>${nonFolderPlayer.getUsername()} wins the pot of $${pot} (All others folded).</b>`);
    if (winnerUser) {
      winnerUser.rating = (winnerUser.rating || 0) + winnerGain;
      await winnerUser.save();

      const history = await RatingHistory.create({
        rating_calculation_id: calc.id,
        user_id: winnerUser.id,
        rating_after: winnerUser.rating,
        rank: 1,
        poker_hand: 'All others folded'
      });
      await history.save();
    }

    const netResults = [];
    netResults.push({
      player: nonFolderPlayer,
      result: pot - this.getTotalInvested(nonFolderPlayer)
    });

    // Losers (Folders who invested)
    for (const p of this.players) {
      if (p !== nonFolderPlayer) {
        const invested = this.getTotalInvested(p);
        netResults.push({
          player: p,
          result: -invested
        });
        if (invested > 0) {
          const loserUser = await User.fromName(p.getUsername());
          if (loserUser) {
            const loserLoss = Math.round(invested * MULTIPLIER);
            loserUser.rating = (loserUser.rating || 0) - loserLoss;
            await loserUser.save();

            const history = await RatingHistory.create({
              rating_calculation_id: calc.id,
              user_id: loserUser.id,
              rating_after: loserUser.rating,
              rank: 2,
              poker_hand: 'Fold'
            });
            await history.save();
          }
        }
      }
    }

    this.calculateSpirituality(netResults);
  } catch (err) {
    console.error(`Failed to update poker rating (fold): ${err.message}`);
  }
})();

    let cardData = [];
    for (let i = 0; i < this.players.length; i++) {
      cardData.push({
        username: this.players[i].getUsername(),
        money: this.players[i].getMoney(),
        text: this.players[i].getStatus(),
      });
    }
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      this.players[pn].emit('endHand', {
        winner: username,
        folded: this.players[pn].getUsername() != username ? 'Fold' : '',
        username: this.players[pn].getUsername(),
        pot: this.getCurrentPot(),
        money: this.players[pn].getMoney(),
        cards: cardData,
        bets: this.roundData.bets,
      });
    }
  };

  this.revealCards = (winners) => {
    this.log('revealllllll');
    this.roundInProgress = false;
    let cardData = [];
    for (let i = 0; i < this.players.length; i++) {
      const winData = winners.find((w) => w.player === this.players[i]);
      cardData.push({
        username: this.players[i].getUsername(),
        cards: this.players[i].cards,
        hand: this.players[i].getStatus(),
        folded: this.players[i].getStatus() == 'Fold',
        money: this.players[i].getMoney(),
        buyIns: this.players[i].buyIns,
        gain: winData ? winData.gain : null,
      });
    }
    const winnersUsernames = winners
      .map((a) => a.player.getUsername())
      .toString();
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      this.players[pn].emit('reveal', {
        username: this.players[pn].getUsername(),
        money: this.players[pn].getMoney(),
        cards: cardData,
        bets: this.roundData.bets,
        winners: winnersUsernames,
        hand: this.players[pn].getStatus(),
      });
    }
  };

  this.allPlayersAllIn = () => {
    let participatingPlayers = 0;
    const activePlayers = this.players.filter(p => !p.waiting);
    for (player of activePlayers) {
      if (!player.allIn && player.getStatus() != 'Fold') participatingPlayers++;
    }
    return participatingPlayers <= 1;
  };

  this.isStageComplete = () => {
    const activePlayers = this.players.filter(p => !p.waiting);
    let allPlayersPresent = false;
    let numUnfolded = 0;
    for (let i = 0; i < activePlayers.length; i++) {
      if (activePlayers[i].status != 'Fold' && !activePlayers[i].allIn)
        numUnfolded++;
    }
    const currRound = this.getCurrentRoundBets();
    if (this.roundData.bets.length == 1) {
      allPlayersPresent =
        currRound.filter((a) => a.bet != 'Fold').length >= numUnfolded &&
        this.bigBlindWent;
    } else {
      allPlayersPresent =
        currRound.filter((a) => a.bet != 'Fold').length >= numUnfolded;
    }
    this.log('all players present ' + allPlayersPresent);
    let allPlayersCall = true;
    for (player of activePlayers) {
      if (
        player.getStatus() != 'Fold' &&
        this.getPlayerBetInStage(player) != this.getCurrentTopBet() &&
        !player.allIn
      ) {
        allPlayersCall = false;
        break;
      }
    }
    this.log('all players call ' + allPlayersCall);
    return allPlayersPresent && allPlayersCall;
  };

  this.setCardsPerPlayer = (numCards) => {
    this.cardsPerPlayer = numCards;
  };

  this.getHostName = () => {
    return this.host;
  };

  this.getPlayersArray = () => {
    return this.players.map((p) => {
      return p.getUsername();
    });
  };

  this.getCode = () => {
    return this.gameName;
  };

  this.addPlayer = (playerName, socket) => {
    const player = new Player(playerName, socket, this.debug);
    if (this.roundInProgress) {
      player.waiting = true;
    }
    this.players.push(player);
    return player;
  };

  this.getNumPlayers = () => {
    return this.players.length;
  };

  this.startGame = () => {
    this.dealCards();
    this.emitPlayers('startGame', {
      players: this.players.map((p) => {
        return p.username;
      }),
    });
    this.startNewRound();
  };

  this.dealCards = () => {
    this.deck.shuffle();
    const activePlayers = this.players.filter(p => !p.waiting);
    for (let pn = 0; pn < this.players.length; pn++) {
      this.players[pn].cards = [];
    }
    for (let pn = 0; pn < activePlayers.length; pn++) {
      for (let i = 0; i < this.cardsPerPlayer; i++) {
        activePlayers[pn].addCard(this.deck.dealRandomCard());
      }
    }

    this.refreshCards();
  };

  this.refreshCards = function () {
    const activePlayers = this.players.filter(p => !p.waiting);
    for (let pn = 0; pn < activePlayers.length; pn++) {
      activePlayers[pn].cards.sort((a, b) => {
        return a.compare(b);
      });

      activePlayers[pn].emit('dealt', {
        currBet: this.getCurrentTopBet(),
        username: activePlayers[pn].getUsername(),
        cards: activePlayers[pn].cards,
        players: activePlayers.map((p) => {
          return p.username;
        }),
      });
    }
  };

  this.emitPlayers = (eventName, payload) => {
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      this.players[pn].emit(eventName, payload);
    }
  };

  this.broadcastLog = (message) => {
    let msg = message;
    if (this.smokeScreenActive) {
      // Mask dollar amounts like $50 or $100.50 with ???
      msg = msg.replace(/\$\d+(\.\d+)?/g, '$???');
    }
    this.emitPlayers('gameLog', { message: msg });
  };

  this.findPlayer = (socketId) => {
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      if (this.players[pn].socket.id === socketId) {
        return this.players[pn];
      }
    }
    return { socket: { id: 0 } };
  };

  this.disconnectPlayer = (player) => {
    this.disconnectedPlayers.push(player);
    if (player.getStatus() == 'Their Turn') {
      this.moveOntoNextPlayer();
    }
    player.away = true;
    this.broadcastLog(`${player.getUsername()} is now away.`);
    this.emitPlayers('playerDisconnected', { player: player.getUsername() });
    this.rerender();
  };

  this.checkBigBlindWent = (socket) => {
    if (
      this.findPlayer(socket.id).blindValue == 'Big Blind' &&
      this.roundData.bets.length == 1
    ) {
      this.bigBlindWent = true;
    }
  };

  this.getCurrentRoundBets = () => {
    return this.roundData.bets[this.roundData.bets.length - 1];
  };

  this.setCurrentRoundBets = (bets) => {
    return (this.roundData.bets[this.roundData.bets.length - 1] = bets);
  };

  this.fold = (socket) => {
    this.checkBigBlindWent(socket);
    const player = this.findPlayer(socket.id);
    let preFoldBetAmount = 0;

    let roundDataStage = this.getCurrentRoundBets().find(
      (a) => a.player == player.getUsername()
    );
    if (roundDataStage != undefined && roundDataStage.bet != 'Fold') {
      preFoldBetAmount += roundDataStage.bet;
    }
    player.setStatus('Fold');
    this.broadcastLog(`${player.getUsername()} folded.`);
    this.foldPot = this.foldPot + preFoldBetAmount;
    if (
      this.getCurrentRoundBets().some((a) => a.player == player.getUsername())
    ) {
      this.setCurrentRoundBets(
        this.getCurrentRoundBets().map((a) =>
          a.player == player.getUsername()
            ? { player: player.getUsername(), bet: 'Fold' }
            : a
        )
      );
    } else {
      this.getCurrentRoundBets().push({
        player: player.getUsername(),
        bet: 'Fold',
      });
    }
    this.lastMoveParsed = { move: 'Fold', player: player };
    player.isSilenced = false;
    this.moveOntoNextPlayer();
    return true;
  };

  this.call = (socket) => {
    this.checkBigBlindWent(socket);
    const player = this.findPlayer(socket.id);
    let currBet = this.getPlayerBetInStage(player);
    const topBet = this.getCurrentTopBet();
    if (currBet === 0) {
      if (
        this.getCurrentRoundBets().some((a) => a.player == player.getUsername())
      ) {
        if (player.getMoney() - topBet <= 0) {
          this.setCurrentRoundBets(
            this.getCurrentRoundBets().map((a) =>
              a.player == player.username
                ? { player: player.getUsername(), bet: player.getMoney() }
                : a
            )
          );
          player.money = 0;
          player.allIn = true;
        } else {
          this.setCurrentRoundBets(
            this.getCurrentRoundBets().map((a) =>
              a.player == player.username
                ? { player: player.getUsername(), bet: topBet }
                : a
            )
          );
          player.money = player.money - topBet;
        }
      } else {
        if (player.getMoney() - topBet <= 0) {
          this.getCurrentRoundBets().push({
            player: player.getUsername(),
            bet: player.getMoney(),
          });
          player.money = 0;
          player.allIn = true;
        } else {
          this.getCurrentRoundBets().push({
            player: player.getUsername(),
            bet: topBet,
          });
          player.money = player.money - topBet;
        }
      }
      this.moveOntoNextPlayer();
      this.broadcastLog(`${player.getUsername()} called (Total bet: $${this.getPlayerBetInStage(player)}).`);
      player.isSilenced = false;
      return true;
    } else {
      if (
        this.getCurrentRoundBets().some((a) => a.player == player.getUsername())
      ) {
        if (player.getMoney() + currBet - topBet <= 0) {
          this.setCurrentRoundBets(
            this.getCurrentRoundBets().map((a) =>
              a.player == player.username
                ? {
                    player: player.getUsername(),
                    bet: player.getMoney() + currBet,
                  }
                : a
            )
          );
          player.money = 0;
          player.allIn = true;
          this.broadcastLog(`${player.getUsername()} called All-In (Total bet: $${this.getPlayerBetInStage(player)}).`);
        } else {
          this.setCurrentRoundBets(
            this.getCurrentRoundBets().map((a) =>
              a.player == player.username
                ? { player: player.getUsername(), bet: topBet }
                : a
            )
          );
          player.money = player.money - (topBet - currBet);
          this.broadcastLog(`${player.getUsername()} called (Total bet: $${this.getPlayerBetInStage(player)}).`);
        }
        player.isSilenced = false;
        this.moveOntoNextPlayer();
        return true;
      } else {
        this.log('this should not happen');
      }
    }
  };

  this.bet = (socket, bet) => {
    this.checkBigBlindWent(socket);
    if (bet >= this.bigBlind) {
      const player = this.findPlayer(socket.id);
      if (player.getMoney() - bet >= 0) {
        this.setCurrentRoundBets(
          this.getCurrentRoundBets().filter(
            (a) => a.player != player.getUsername()
          )
        );
        this.getCurrentRoundBets().push({
          player: player.getUsername(),
          bet: bet,
        });
        player.money = player.money - bet;
        if (player.money == 0) player.allIn = true;
        this.broadcastLog(`${player.getUsername()} bet $${bet}${player.allIn ? ' (All-In)' : ''}.`);
        player.isSilenced = false;
        this.moveOntoNextPlayer();
        return true;
      }
    }
  };

  this.check = (socket) => {
    this.checkBigBlindWent(socket);
    let currBet = 0;
    const player = this.findPlayer(socket.id);
    if (
      this.getCurrentRoundBets().find(
        (a) => a.player == player.getUsername()
      ) != undefined
    ) {
      currBet = this.getCurrentRoundBets().find(
        (a) => a.player == player.getUsername()
      ).bet;
      this.setCurrentRoundBets(
        this.getCurrentRoundBets().map((a) =>
          a.player == player.getUsername()
            ? { player: player.getUsername(), bet: currBet }
            : a
        )
      );
    } else {
      this.getCurrentRoundBets().push({
        player: player.getUsername(),
        bet: currBet,
      });
    }
    this.broadcastLog(`${player.getUsername()} checked.`);
    player.isSilenced = false;
    this.moveOntoNextPlayer();
    return true;
  };

  this.raise = (socket, bet) => {
    this.checkBigBlindWent(socket);
    const topBet = this.getCurrentTopBet();
    const player = this.findPlayer(socket.id);
    const currBet = this.getPlayerBetInStage(player);
    
    let totalBet = bet;
    if (this.smokeScreenActive) {
      // In smoke screen, 'bet' is treated as delta
      totalBet = topBet + bet;
    }

    const moneyToRemove = totalBet - currBet;
    if (
      moneyToRemove > 0 &&
      totalBet >= topBet &&
      player.getMoney() - moneyToRemove >= 0
    ) {
      if (currBet === 0) {
        this.setCurrentRoundBets(
          this.getCurrentRoundBets().filter(
            (a) => a.player != player.getUsername()
          )
        );
        this.getCurrentRoundBets().push({
          player: player.getUsername(),
          bet: totalBet,
        });
      } else {
        this.setCurrentRoundBets(
          this.getCurrentRoundBets().map((a) =>
            a.player == player.getUsername()
              ? { player: player.getUsername(), bet: totalBet }
              : a
          )
        );
      }
      player.money -= moneyToRemove;
      if (player.money == 0) player.allIn = true;
      this.broadcastLog(`${player.getUsername()} raised to $${totalBet}${player.allIn ? ' (All-In)' : ''}.`);
      player.isSilenced = false;
      this.moveOntoNextPlayer();
      return true;
    }
  };

  this.getPossibleMoves = (socket) => {
    const player = this.findPlayer(socket.id);
    const playerBet = this.getPlayerBetInStage(player);
    const topBet = this.getCurrentTopBet();
    let possibleMoves = {
      fold: 'yes',
      check: 'yes',
      bet: 'yes',
      call: topBet,
      raise: 'yes',
    };
    if (player.getStatus() == 'Fold') {
      this.log('Error: Folded players should not be able to move.');
    }
    if (topBet != 0) {
      possibleMoves.bet = 'no';
      possibleMoves.check = 'no';
      if (
        player.blindValue == 'Big Blind' &&
        !this.bigBlindWent &&
        topBet == this.bigBlind
      )
        possibleMoves.check = 'yes';
    } else {
      possibleMoves.raise = 'no';
    }
    if (topBet <= playerBet) {
      possibleMoves.call = 'no';
    }
    if (topBet >= player.getMoney() + playerBet) {
      possibleMoves.raise = 'no';
      possibleMoves.call = 'all-in';
    }
    if (player.isSilenced) {
      possibleMoves.raise = 'no';
      possibleMoves.allIn = 'no';
    }
    if (this.smokeScreenActive) {
      possibleMoves.isSmoke = true;
    }
    return possibleMoves;
  };

  this.calculateSpirituality = (netResults) => {
    for (const res of netResults) {
      if (res.result < 0) {
        const points = Math.floor(Math.abs(res.result) / 10);
        if (points > 0) {
          res.player.spirituality += points;
          this.broadcastLog(`${res.player.getUsername()} gained ${points} Spirituality.`);
        }
      }
    }
  };

  this.assignSkills = () => {
    const skills = [
      { id: 'reveal', name: 'Reveal Hand (明牌)', cost: 0 },
      { id: 'swap', name: 'Swap Card (换牌术)', cost: 5 },
      { id: 'silence', name: 'Silence (沉默)', cost: 10 },
      { id: 'smoke', name: 'Smoke Screen (烟雾弹)', cost: 20 },
      { id: 'fate', name: 'Exchange Fate (交换命运)', cost: 30 }
    ];

    for (const player of this.players) {
      const affordable = skills.filter(s => s.cost <= player.spirituality);
      if (affordable.length > 0) {
        player.assignedSkill = affordable[Math.floor(Math.random() * affordable.length)];
      } else {
        player.assignedSkill = null;
      }
    }
  };

  this.useSkill = (socket, targetName) => {
    const player = this.findPlayer(socket.id);
    if (!this.roundInProgress || !player || !player.assignedSkill || player.skillUsed) return;

    const skill = player.assignedSkill;
    const target = targetName ? this.players.find(p => p.getUsername() === targetName) : null;

    if (skill.id === 'reveal') {
      player.revealed = true;
      this.broadcastLog(`${player.getUsername()} used <b>Reveal Hand</b>!`);
    } else if (skill.id === 'swap') {
      const cardIndex = (targetName !== undefined && !isNaN(parseInt(targetName))) ? parseInt(targetName) : player.cards.length - 1;
      player.cards.splice(cardIndex, 1);
      player.addCard(this.deck.dealRandomCard());
      player.cards.sort((a, b) => a.compare(b));
      player.emit('dealt', {
        currBet: this.getCurrentTopBet(),
        username: player.getUsername(),
        cards: player.cards,
        players: this.players.filter(p => !p.waiting).map(p => p.username),
      });
      this.broadcastLog(`${player.getUsername()} used <b>Swap Card</b>!`);
    } else if (skill.id === 'silence') {
      if (!target) return;
      target.isSilenced = true;
      this.broadcastLog(`${player.getUsername()} used <b>Silence</b> on ${target.getUsername()}!`);
    } else if (skill.id === 'smoke') {
      this.smokeScreenActive = true;
      this.broadcastLog(`${player.getUsername()} used <b>Smoke Screen</b>! Information is now hidden.`);
    } else if (skill.id === 'fate') {
      if (!target) return;
      const tempCards = player.cards;
      player.cards = target.cards;
      target.cards = tempCards;

      [player, target].forEach(p => {
        p.emit('dealt', {
          currBet: this.getCurrentTopBet(),
          username: p.getUsername(),
          cards: p.cards,
          players: this.players.filter(p => !p.waiting).map(p => p.username),
        });
      });
      this.broadcastLog(`${player.getUsername()} used <b>Exchange Fate</b> with ${target.getUsername()}!`);
    }

    player.spirituality -= skill.cost;
    player.skillUsed = true;
    this.rerender();
  };
};

module.exports = Game;
