const BASE_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
// For sequential patterns (straights, 三连对, 二连三) the Ace can act either
// as the card below 2 (forming the lowest run, A-2-3-4-5) or in its normal
// spot above King (10-J-Q-K-A, the highest run) - never both ends wrapping
// anywhere else. Position 0 and 13 are both "A"; everything else appears once.
const STRAIGHT_SEQUENCE = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_LABELS = { S: '♠', H: '♥', D: '♦', C: '♣', J: '' };
const LEVEL_ADVANCE = { double: 4, oneThree: 2, oneFour: 1 };
const RATING_DELTA = { double: 200, oneThree: 100, oneFour: 50 };
const AWAY_AUTO_ACTION_MS = 20000;

function nextRank(rank, steps) {
  let idx = BASE_RANKS.indexOf(rank);
  if (idx === -1) idx = 0;
  return BASE_RANKS[Math.min(BASE_RANKS.length - 1, idx + steps)];
}

function cloneCard(card) {
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    label: card.label,
    suitLabel: card.suitLabel,
    joker: card.joker || null,
    deck: card.deck,
  };
}

class GuandanRules {
  static rankOrder(rank, levelRank) {
    if (rank === 'SJ') return 15;
    if (rank === 'BJ') return 16;
    if (rank === levelRank) return 14;
    const withoutLevel = BASE_RANKS.filter((r) => r !== levelRank);
    return withoutLevel.indexOf(rank) + 1;
  }

  static baseOrder(rank) {
    return BASE_RANKS.indexOf(rank);
  }

  static isWild(card, levelRank) {
    return card && card.suit === 'H' && card.rank === levelRank && !card.joker;
  }

  static isTributeEligible(card, levelRank) {
    return !GuandanRules.isWild(card, levelRank);
  }

  static isReturnEligible(card) {
    return ['2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(card.rank) && !card.joker;
  }

  static createDeck() {
    const cards = [];
    for (let deck = 0; deck < 2; deck++) {
      for (const suit of SUITS) {
        for (const rank of BASE_RANKS) {
          cards.push({
            id: `${deck}-${suit}-${rank}`,
            deck,
            suit,
            rank,
            label: rank,
            suitLabel: SUIT_LABELS[suit],
          });
        }
      }
      cards.push({
        id: `${deck}-J-SJ`,
        deck,
        suit: 'J',
        rank: 'SJ',
        label: '小王',
        suitLabel: '',
        joker: 'small',
      });
      cards.push({
        id: `${deck}-J-BJ`,
        deck,
        suit: 'J',
        rank: 'BJ',
        label: '大王',
        suitLabel: '',
        joker: 'big',
      });
    }
    return cards;
  }

  static sortCards(cards, levelRank) {
    cards.sort((a, b) => {
      const diff = GuandanRules.rankOrder(a.rank, levelRank) - GuandanRules.rankOrder(b.rank, levelRank);
      if (diff !== 0) return diff;
      if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
      return a.deck - b.deck;
    });
  }

  static enumerateWildAssignments(cards, levelRank) {
    const wildIndexes = [];
    const fixed = cards.map((card, idx) => {
      if (GuandanRules.isWild(card, levelRank)) {
        wildIndexes.push(idx);
        return null;
      }
      return {
        rank: card.rank,
        suit: card.suit,
        joker: card.joker || null,
        wild: false,
      };
    });

    if (wildIndexes.length === 0) return [fixed];
    if (cards.length === 1 && wildIndexes.length === 1) {
      return [[{ rank: levelRank, suit: 'H', joker: null, wild: true }]];
    }

    const assignments = [];
    const choices = [];
    for (const rank of BASE_RANKS) {
      for (const suit of SUITS) choices.push({ rank, suit, joker: null, wild: true });
    }

    function dfs(pos, current) {
      if (pos === wildIndexes.length) {
        assignments.push(current.map((x) => Object.assign({}, x)));
        return;
      }
      for (const choice of choices) {
        current[wildIndexes[pos]] = choice;
        dfs(pos + 1, current);
      }
    }

    dfs(0, fixed.slice());
    return assignments;
  }

  static evaluate(cards, levelRank) {
    const options = GuandanRules.evaluateOptions(cards, levelRank);
    return options[options.length - 1] || null;
  }

  // Returns every distinct legal interpretation of `cards` (e.g. a red-heart
  // wildcard completing a straight at two different high cards, or a natural
  // straight flush that could also be declared as a plain straight), sorted
  // weakest-first. When more than one option exists the caller must let the
  // player pick, since which one they want is a real strategic choice.
  static evaluateOptions(cards, levelRank) {
    if (!Array.isArray(cards) || cards.length === 0) return [];
    const candidates = [];
    const assignments = GuandanRules.enumerateWildAssignments(cards, levelRank);
    for (const assigned of assignments) {
      candidates.push(...GuandanRules.evaluateAssigned(assigned, cards, levelRank));
    }
    const seen = new Set();
    const options = [];
    for (const candidate of candidates) {
      const key = `${candidate.type}|${candidate.size}|${candidate.primary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(candidate);
    }
    options.sort((a, b) => GuandanRules.compareSameOrPower(a, b));
    return options;
  }

  static evaluateAssigned(assigned, originalCards, levelRank) {
    const len = assigned.length;
    const candidates = [];
    const ranks = assigned.map((c) => c.rank);
    const suits = assigned.map((c) => c.suit);
    const rankCounts = new Map();
    for (const rank of ranks) rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
    const counts = Array.from(rankCounts.entries()).sort((a, b) => b[1] - a[1]);
    const allJokers = assigned.every((c) => c.joker);
    const hasJoker = assigned.some((c) => c.joker);

    if (len === 4 && allJokers && ranks.filter((r) => r === 'SJ').length === 2 && ranks.filter((r) => r === 'BJ').length === 2) {
      candidates.push({ type: 'kingBomb', size: 4, primary: 100, title: '天王炸' });
      return candidates;
    }

    if (counts.length === 1 && len >= 4 && !hasJoker) {
      candidates.push({
        type: 'bomb',
        size: len,
        primary: GuandanRules.rankOrder(counts[0][0], levelRank),
        title: `${len}炸`,
      });
    }

    if (len === 5 && !hasJoker && GuandanRules.isStraightRanks(ranks)) {
      const nonWildSuits = originalCards
        .filter((card) => !GuandanRules.isWild(card, levelRank))
        .map((card) => card.suit);
      const flush = nonWildSuits.length === 0 || nonWildSuits.every((suit) => suit === nonWildSuits[0]);
      if (flush && suits.every((suit) => suit === suits[0])) {
        candidates.push({
          type: 'straightFlush',
          size: 5,
          primary: GuandanRules.straightHigh(ranks),
          title: '同花顺',
        });
      }
    }

    if (len === 1) {
      candidates.push({
        type: 'single',
        size: 1,
        primary: GuandanRules.rankOrder(ranks[0], levelRank),
        title: '单张',
      });
    }

    if (len === 2 && counts.length === 1) {
      candidates.push({
        type: 'pair',
        size: 2,
        primary: GuandanRules.rankOrder(counts[0][0], levelRank),
        title: '对子',
      });
    }

    if (len === 3 && counts.length === 1 && !hasJoker) {
      candidates.push({
        type: 'triple',
        size: 3,
        primary: GuandanRules.rankOrder(counts[0][0], levelRank),
        title: '三张',
      });
    }

    if (len === 5 && counts.length === 2 && !hasJoker) {
      const triple = counts.find((entry) => entry[1] === 3);
      const pair = counts.find((entry) => entry[1] === 2);
      if (triple && pair) {
        candidates.push({
          type: 'threeWithPair',
          size: 5,
          primary: GuandanRules.rankOrder(triple[0], levelRank),
          title: '三带二',
        });
      }
    }

    if (len === 5 && !hasJoker && GuandanRules.isStraightRanks(ranks)) {
      candidates.push({
        type: 'straight',
        size: 5,
        primary: GuandanRules.straightHigh(ranks),
        title: '顺子',
      });
    }

    if (len === 6 && !hasJoker && counts.length === 3 && counts.every((entry) => entry[1] === 2)) {
      const pairRanks = counts.map((entry) => entry[0]);
      const high = GuandanRules._matchSequence(pairRanks);
      if (high !== null) {
        candidates.push({
          type: 'consecutivePairs',
          size: 6,
          primary: high,
          title: '三连对',
        });
      }
    }

    if (len === 6 && !hasJoker && counts.length === 2 && counts.every((entry) => entry[1] === 3)) {
      const tripleRanks = counts.map((entry) => entry[0]);
      const high = GuandanRules._matchSequence(tripleRanks);
      if (high !== null) {
        candidates.push({
          type: 'consecutiveTriples',
          size: 6,
          primary: high,
          title: '二连三',
        });
      }
    }

    // Attach a human-readable rank breakdown to every candidate, used to show
    // the player what each ambiguous interpretation actually looks like.
    const uniqueRanks = Array.from(new Set(ranks));
    let displayRanks = uniqueRanks.slice().sort((a, b) => BASE_RANKS.indexOf(a) - BASE_RANKS.indexOf(b));
    if (uniqueRanks.length > 1 && uniqueRanks.includes('A')) {
      // If treating the Ace as the low end (A-2-3-4-5 style) makes this a
      // tight run, display it that way instead of showing the Ace last.
      const posAceLow = (r) => (r === 'A' ? 0 : STRAIGHT_SEQUENCE.indexOf(r));
      const sortedPositions = uniqueRanks.map(posAceLow).sort((a, b) => a - b);
      const isTightRun = sortedPositions[sortedPositions.length - 1] - sortedPositions[0] === sortedPositions.length - 1;
      if (isTightRun) {
        displayRanks = uniqueRanks.slice().sort((a, b) => posAceLow(a) - posAceLow(b));
      }
    }
    for (const candidate of candidates) candidate.assignedRanks = displayRanks;

    return candidates;
  }

  // A straight is 5 distinct, sequential ranks (2 through A, no wraparound).
  // 2 is a normal low card here and CAN be the bottom of a straight (2-3-4-5-6
  // is the lowest one); only jokers are never part of a straight.
  static isStraightRanks(ranks) {
    if (new Set(ranks).size !== ranks.length) return false;
    return GuandanRules.isConsecutiveRanks(ranks) && !ranks.includes('SJ') && !ranks.includes('BJ');
  }

  // Returns the highest STRAIGHT_SEQUENCE position of a valid consecutive
  // assignment for `ranks`, trying both roles for an Ace if present, or null
  // if no assignment is consecutive.
  static _matchSequence(ranks) {
    if (ranks.some((rank) => !STRAIGHT_SEQUENCE.includes(rank))) return null;
    const aceChoices = ranks.includes('A') ? [0, 13] : [null];
    for (const aceChoice of aceChoices) {
      const positions = ranks.map((rank) => (rank === 'A' ? aceChoice : STRAIGHT_SEQUENCE.indexOf(rank)));
      const sorted = positions.slice().sort((a, b) => a - b);
      let ok = true;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) { ok = false; break; }
      }
      if (ok) return Math.max(...positions);
    }
    return null;
  }

  static isConsecutiveRanks(ranks) {
    return GuandanRules._matchSequence(ranks) !== null;
  }

  static straightHigh(ranks) {
    return GuandanRules._matchSequence(ranks);
  }

  static compareSameOrPower(a, b) {
    const power = { single: 1, pair: 2, triple: 3, straight: 4, consecutivePairs: 5, consecutiveTriples: 6, threeWithPair: 7, bomb: 20, straightFlush: 25, kingBomb: 30 };
    if (power[a.type] !== power[b.type]) return power[a.type] - power[b.type];
    if ((a.size || 0) !== (b.size || 0)) return (a.size || 0) - (b.size || 0);
    return a.primary - b.primary;
  }

  static canBeat(play, last) {
    if (!play) return false;
    if (!last) return true;
    if (play.type === 'kingBomb') return last.type !== 'kingBomb';
    if (last.type === 'kingBomb') return false;

    if (play.type === 'bomb') {
      if (last.type === 'straightFlush') return play.size >= 6;
      if (last.type === 'bomb') {
        if (play.size !== last.size) return play.size > last.size;
        return play.primary > last.primary;
      }
      return true;
    }

    if (play.type === 'straightFlush') {
      if (last.type === 'bomb') return last.size <= 5;
      if (last.type === 'straightFlush') return play.primary > last.primary;
      return true;
    }

    if (last.type === 'bomb' || last.type === 'straightFlush') return false;
    return play.type === last.type && play.size === last.size && play.primary > last.primary;
  }
}

class GuandanGame {
  constructor(code, host) {
    this.code = code;
    this.host = host;
    this.players = [];
    this.spectators = [];
    this.phase = 'lobby';
    this.handNumber = 0;
    this.teamLevels = ['2', '2'];
    this.leadingTeam = 0;
    this.currentLevel = '2';
    this.currentTurn = null;
    this.firstLead = 0;
    this.lastPlay = null;
    this.passCount = 0;
    this.finishOrder = [];
    this.previousFinishOrder = null;
    this.pendingTributes = [];
    this.pendingReturns = [];
    this.tributeRecipients = [];
    this.lastTributeResults = {};
    this.handOverReady = new Set();
    this.awayTimer = null;
    this.logs = [];
    this.roundInProgress = false;
    this.gameOver = false;
  }

  getCode() {
    return this.code;
  }

  getHostName() {
    return this.host;
  }

  getPlayersArray() {
    return this.players.map((p) => p.username);
  }

  addPlayer(username, socket) {
    if (this.players.length >= 4 || this.phase !== 'lobby') return null;
    const player = {
      username,
      socket,
      seat: this.players.length,
      team: this.players.length % 2,
      hand: [],
      away: false,
      finishedRank: null,
    };
    this.players.push(player);
    return player;
  }

  reconnectPlayer(username, socket) {
    const player = this.players.find((p) => p.username === username);
    if (!player) return null;
    player.socket = socket;
    player.away = false;
    this.broadcastLog(`${username} reconnected.`);
    this.rerender();
    return player;
  }

  findPlayerBySocket(socketId) {
    return this.players.find((p) => p.socket && p.socket.id === socketId) || null;
  }

  addSpectator(username, socket) {
    const spectator = { username, socket };
    this.spectators.push(spectator);
    return spectator;
  }

  removeSpectatorBySocket(socketId) {
    this.spectators = this.spectators.filter((s) => !s.socket || s.socket.id !== socketId);
  }

  emitPlayers(eventName, payload) {
    for (const player of this.players) {
      if (player.socket) player.socket.emit(eventName, payload);
    }
  }

  emitSpectators(eventName, payload) {
    for (const spectator of this.spectators) {
      if (spectator.socket) spectator.socket.emit(eventName, payload);
    }
  }

  broadcastLog(message) {
    this.logs.push(message);
    if (this.logs.length > 200) this.logs.shift();
    this.emitPlayers('gameLog', { message });
    this.emitSpectators('gameLog', { message });
  }

  startGame() {
    if (this.players.length !== 4 || this.phase !== 'lobby') return false;
    this.firstLead = Math.floor(Math.random() * 4);
    this.emitPlayers('gameBegin', { code: this.code });
    this.startNewHand();
    return true;
  }

  startNewHand() {
    if (this.gameOver) return false;
    this.handNumber += 1;
    this.currentLevel = this.teamLevels[this.leadingTeam];
    this.finishOrder = [];
    this.lastPlay = null;
    this.passCount = 0;
    this.pendingTributes = [];
    this.pendingReturns = [];
    this.tributeRecipients = [];
    this.lastTributeResults = {};
    this.handOverReady = new Set();
    this.roundInProgress = true;
    for (const player of this.players) {
      player.hand = [];
      player.finishedRank = null;
    }

    const deck = GuandanRules.createDeck();
    this.shuffle(deck);
    for (let i = 0; i < deck.length; i++) {
      this.players[i % 4].hand.push(deck[i]);
    }
    for (const player of this.players) GuandanRules.sortCards(player.hand, this.currentLevel);

    this.broadcastLog(`Hand ${this.handNumber} begins. Level card: ${this.currentLevel}.`);
    if (this.handNumber > 1 && this.previousFinishOrder) {
      this.setupTribute();
    } else {
      this.phase = 'playing';
      this.currentTurn = this.firstLead;
      this.broadcastLog(`${this.players[this.currentTurn].username} leads first.`);
    }
    this.rerender();
    return true;
  }

  shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
  }

  setupTribute() {
    const order = this.previousFinishOrder;
    const first = order[0];
    const second = order[1];
    const third = order[2];
    const fourth = order[3];
    const firstTeam = this.players[first].team;
    const secondTeam = this.players[second].team;
    const givers = [];

    if (firstTeam === secondTeam) {
      givers.push({ from: third, to: null }, { from: fourth, to: null });
      this.tributeRecipients = [first, second];
    } else {
      givers.push({ from: fourth, to: first });
      this.tributeRecipients = [first];
    }

    const antiTribute = givers.some((item) => {
      return this.players[item.from].hand.filter((card) => card.rank === 'BJ').length >= 2;
    });

    if (antiTribute) {
      this.phase = 'playing';
      this.currentTurn = first;
      this.broadcastLog('Anti-tribute: tribute side has two big jokers. Tribute is skipped.');
      return;
    }

    this.phase = 'tribute';
    this.pendingTributes = givers.map((item) => Object.assign({ cardId: null }, item));
    this.currentTurn = givers[0].from;
    this.broadcastLog('Tribute phase begins.');
  }

  selectTribute(socketId, cardId) {
    const player = this.findPlayerBySocket(socketId);
    if (!player) return { ok: false, message: 'Unknown player.' };
    return this.selectTributeForPlayer(player, cardId);
  }

  selectTributeForPlayer(player, cardId) {
    if (this.phase !== 'tribute') return { ok: false, message: 'Not in tribute phase.' };
    const entry = this.pendingTributes.find((item) => item.from === player.seat && !item.cardId);
    if (!entry) return { ok: false, message: 'No tribute required from you.' };
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return { ok: false, message: 'Card is not in your hand.' };
    if (!GuandanRules.isTributeEligible(card, this.currentLevel)) return { ok: false, message: 'Red heart level card cannot be tributed.' };
    const eligible = player.hand.filter((c) => GuandanRules.isTributeEligible(c, this.currentLevel));
    const maxOrder = Math.max(...eligible.map((c) => GuandanRules.rankOrder(c.rank, this.currentLevel)));
    if (GuandanRules.rankOrder(card.rank, this.currentLevel) !== maxOrder) return { ok: false, message: 'You must tribute one of your highest eligible cards.' };
    entry.cardId = cardId;
    this.broadcastLog(`${player.username} selected a tribute card.`);
    if (this.pendingTributes.every((item) => item.cardId)) this.applyTributes();
    this.rerender();
    return { ok: true };
  }

  applyTributes() {
    this.pendingReturns = [];
    const sortedTributes = this.pendingTributes.slice();
    if (sortedTributes.length === 2) {
      sortedTributes.sort((a, b) => {
        const cardA = this.players[a.from].hand.find((card) => card.id === a.cardId);
        const cardB = this.players[b.from].hand.find((card) => card.id === b.cardId);
        const rankDiff = GuandanRules.rankOrder(cardB.rank, this.currentLevel) - GuandanRules.rankOrder(cardA.rank, this.currentLevel);
        if (rankDiff !== 0) return rankDiff;
        return cardB.id.localeCompare(cardA.id);
      });
      sortedTributes.forEach((tribute, index) => {
        tribute.to = this.tributeRecipients[index];
      });
    }

    for (const tribute of sortedTributes) {
      const from = this.players[tribute.from];
      const to = this.players[tribute.to];
      const card = this.removeCard(from, tribute.cardId);
      to.hand.push(card);
      this.pendingReturns.push({ from: tribute.to, to: tribute.from, cardId: null });
      this.lastTributeResults[tribute.from] = { toUsername: to.username, cardText: this.cardText(card) };
      this.broadcastLog(`${from.username} tributed ${this.cardText(card)} to ${to.username}.`);
    }
    for (const player of this.players) GuandanRules.sortCards(player.hand, this.currentLevel);
    this.phase = 'return';
    this.currentTurn = this.pendingReturns[0].from;
  }

  selectReturn(socketId, cardId) {
    const player = this.findPlayerBySocket(socketId);
    if (!player) return { ok: false, message: 'Unknown player.' };
    return this.selectReturnForPlayer(player, cardId);
  }

  selectReturnForPlayer(player, cardId) {
    if (this.phase !== 'return') return { ok: false, message: 'Not in return phase.' };
    const entry = this.pendingReturns.find((item) => item.from === player.seat && !item.cardId);
    if (!entry) return { ok: false, message: 'No return required from you.' };
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return { ok: false, message: 'Card is not in your hand.' };
    if (!GuandanRules.isReturnEligible(card)) return { ok: false, message: 'Return card must be 2 through 10.' };
    entry.cardId = cardId;
    this.broadcastLog(`${player.username} selected a return card.`);
    if (this.pendingReturns.every((item) => item.cardId)) this.applyReturns();
    this.rerender();
    return { ok: true };
  }

  applyReturns() {
    for (const item of this.pendingReturns) {
      const from = this.players[item.from];
      const to = this.players[item.to];
      const card = this.removeCard(from, item.cardId);
      to.hand.push(card);
      this.broadcastLog(`${from.username} returned ${this.cardText(card)} to ${to.username}.`);
    }
    for (const player of this.players) GuandanRules.sortCards(player.hand, this.currentLevel);
    this.phase = 'playing';
    // Whoever received the smaller tribute card leads (the sole recipient in the single-tribute case).
    this.currentTurn = this.tributeRecipients[this.tributeRecipients.length - 1];
    this.broadcastLog(`${this.players[this.currentTurn].username} leads after tribute.`);
  }

  playCards(socketId, cardIds, choice) {
    const player = this.findPlayerBySocket(socketId);
    if (!player) return { ok: false, message: 'Unknown player.' };
    return this.playCardsForPlayer(player, cardIds, choice);
  }

  playCardsForPlayer(player, cardIds, choice) {
    if (this.phase !== 'playing') return { ok: false, message: 'Not in playing phase.' };
    if (player.seat !== this.currentTurn) return { ok: false, message: 'It is not your turn.' };
    if (player.finishedRank) return { ok: false, message: 'You already finished.' };
    if (!Array.isArray(cardIds) || cardIds.length === 0) return { ok: false, message: 'Select at least one card.' };

    const selected = [];
    const used = new Set();
    for (const id of cardIds) {
      if (used.has(id)) return { ok: false, message: 'Duplicate card selected.' };
      used.add(id);
      const card = player.hand.find((c) => c.id === id);
      if (!card) return { ok: false, message: 'Selected card is not in your hand.' };
      selected.push(card);
    }

    const options = GuandanRules.evaluateOptions(selected, this.currentLevel);
    if (!options.length) return { ok: false, message: 'Illegal card pattern.' };

    let hand;
    if (options.length === 1) {
      hand = options[0];
    } else if (choice) {
      hand = options.find((o) => o.type === choice.type && o.size === choice.size && o.primary === choice.primary);
      if (!hand) return { ok: false, message: 'Invalid choice.' };
    } else {
      // A red-heart wildcard (or a natural straight flush) can legally form
      // more than one distinct pattern with the exact same selected cards -
      // e.g. 3,4,5,6 + a wild 8 could be a 4-5-6-7 or a 5-6-7-8 straight.
      // Which one to use is a real strategic choice, so ask the player.
      return {
        ok: false,
        needsChoice: true,
        options: options.map((o) => ({
          type: o.type, size: o.size, primary: o.primary, title: o.title, assignedRanks: o.assignedRanks,
        })),
      };
    }

    if (!GuandanRules.canBeat(hand, this.lastPlay && this.lastPlay.hand)) return { ok: false, message: 'This play cannot beat the previous play.' };

    for (const id of cardIds) this.removeCard(player, id);
    this.lastPlay = {
      player: player.seat,
      username: player.username,
      cards: selected.map(cloneCard),
      hand,
    };
    this.passCount = 0;
    this.broadcastLog(`${player.username} played ${hand.title}: ${selected.map((card) => this.cardText(card)).join(' ')}`);

    if (player.hand.length === 0) {
      this.markFinished(player);
      if (this.finishOrder.length === 2 && this.isDoubleUp()) {
        // Both members of a team finished 1st and 2nd: the result (双上) is
        // already the best possible outcome, so end the hand immediately
        // instead of making the other team keep playing it out.
        for (const p of this.players) {
          if (!p.finishedRank) this.markFinished(p);
        }
      } else if (this.finishOrder.length >= 3) {
        const remaining = this.players.find((p) => !p.finishedRank);
        if (remaining) this.markFinished(remaining);
      }
    }

    if (this.finishOrder.length === 4) {
      this.endHand();
    } else {
      this.currentTurn = this.nextUnfinishedFrom(player.seat);
      this.rerender();
    }
    return { ok: true };
  }

  pass(socketId) {
    const player = this.findPlayerBySocket(socketId);
    if (!player) return { ok: false, message: 'Unknown player.' };
    return this.passForPlayer(player);
  }

  passForPlayer(player) {
    if (this.phase !== 'playing') return { ok: false, message: 'Not in playing phase.' };
    if (player.seat !== this.currentTurn) return { ok: false, message: 'It is not your turn.' };
    if (!this.lastPlay) return { ok: false, message: 'You cannot pass while leading.' };
    if (this.lastPlay.player === player.seat) return { ok: false, message: 'You cannot pass your own lead.' };

    this.passCount += 1;
    this.broadcastLog(`${player.username} passed.`);
    const lastPlayer = this.players[this.lastPlay.player];
    const requiredPasses = this.players.filter((p) => !p.finishedRank && p.seat !== lastPlayer.seat).length;
    if (this.passCount >= requiredPasses) {
      const lead = this.nextLeadAfterTrick();
      this.lastPlay = null;
      this.passCount = 0;
      this.currentTurn = lead;
      this.broadcastLog(`${this.players[lead].username} leads the next trick.`);
    } else {
      this.currentTurn = this.nextUnfinishedFrom(player.seat);
    }
    this.rerender();
    return { ok: true };
  }

  nextLeadAfterTrick() {
    const lastSeat = this.lastPlay.player;
    if (!this.players[lastSeat].finishedRank) return lastSeat;
    const teammate = (lastSeat + 2) % 4;
    if (!this.players[teammate].finishedRank) return teammate;
    return this.nextUnfinishedFrom(lastSeat);
  }

  markFinished(player) {
    if (player.finishedRank) return;
    player.finishedRank = this.finishOrder.length + 1;
    this.finishOrder.push(player.seat);
    this.broadcastLog(`${player.username} finished #${player.finishedRank}.`);
  }

  isDoubleUp() {
    if (this.finishOrder.length < 2) return false;
    const firstSeat = this.finishOrder[0];
    const secondSeat = this.finishOrder[1];
    return this.players[firstSeat].team === this.players[secondSeat].team;
  }

  nextUnfinishedFrom(seat) {
    for (let i = 1; i <= 4; i++) {
      const candidate = this.players[(seat + i) % 4];
      if (!candidate.finishedRank) return candidate.seat;
    }
    return seat;
  }

  removeCard(player, cardId) {
    const idx = player.hand.findIndex((card) => card.id === cardId);
    if (idx === -1) return null;
    const card = player.hand[idx];
    player.hand.splice(idx, 1);
    return card;
  }

  endHand() {
    this.phase = 'handOver';
    this.roundInProgress = false;
    const firstSeat = this.finishOrder[0];
    const winnerTeam = this.players[firstSeat].team;
    const teammateSeat = this.players.find((p) => p.team === winnerTeam && p.seat !== firstSeat).seat;
    const teammatePosition = this.finishOrder.indexOf(teammateSeat) + 1;
    let resultType = 'oneFour';
    if (teammatePosition === 2) resultType = 'double';
    else if (teammatePosition === 3) resultType = 'oneThree';

    const oldLevel = this.teamLevels[winnerTeam];
    const delta = RATING_DELTA[resultType];
    const advance = LEVEL_ADVANCE[resultType];
    this.teamLevels[winnerTeam] = nextRank(this.teamLevels[winnerTeam], advance);
    this.leadingTeam = winnerTeam;
    this.firstLead = firstSeat;
    this.previousFinishOrder = this.finishOrder.slice();
    this.gameOver = oldLevel === 'A' && resultType === 'double';
    if (this.gameOver) this.phase = 'gameOver';

    this.broadcastLog(`Team ${winnerTeam + 1} wins this hand (${this.resultText(resultType)}), rating ${delta}.`);
    this.broadcastLog(`Team ${winnerTeam + 1} level: ${oldLevel} -> ${this.teamLevels[winnerTeam]}.`);
    if (this.gameOver) this.broadcastLog(`Team ${winnerTeam + 1} wins the match at A with double-up.`);
    this.applyRating(winnerTeam, delta, resultType).catch((err) => {
      console.error(`Failed to update guandan rating: ${err.message}`);
    });
    this.rerender();
  }

  async applyRating(winnerTeam, delta, resultType) {
    if (typeof syzoj === 'undefined' || !syzoj.model) return;
    const RatingCalculation = syzoj.model('rating_calculation');
    const RatingHistory = syzoj.model('rating_history');
    const User = syzoj.model('user');
    const calc = await RatingCalculation.create({
      poker_name: `guandan game: ${this.code} hand ${this.handNumber}`,
    });
    await calc.save();

    for (const player of this.players) {
      const user = await User.fromName(player.username);
      if (!user) continue;
      const change = player.team === winnerTeam ? delta : -delta;
      user.rating = (user.rating || 0) + change;
      await user.save();
      const history = await RatingHistory.create({
        rating_calculation_id: calc.id,
        user_id: user.id,
        rating_after: user.rating,
        rank: player.finishedRank,
        poker_hand: `掼蛋 ${this.resultText(resultType)} ${change > 0 ? '+' : ''}${change}`,
      });
      await history.save();
    }
  }

  resultText(resultType) {
    if (resultType === 'double') return '双上';
    if (resultType === 'oneThree') return '1、3';
    return '1、4';
  }

  cardText(card) {
    if (!card) return '';
    if (card.joker) return card.label;
    return `${card.label}${card.suitLabel}`;
  }

  disconnectPlayer(player) {
    if (!player) return;
    player.away = true;
    this.broadcastLog(`${player.username} is away.`);
    this.rerender();
  }

  removePlayer(socketId) {
    const player = this.findPlayerBySocket(socketId);
    if (!player) return;
    if (this.phase === 'lobby') {
      this.players = this.players.filter((p) => p !== player);
      this.players.forEach((p, idx) => {
        p.seat = idx;
        p.team = idx % 2;
      });
    } else {
      player.away = true;
    }
    this.rerender();
  }

  rerender() {
    for (const player of this.players) {
      if (player.socket) player.socket.emit('state', this.stateFor(player));
    }
    this.emitSpectators('spectateState', this.stateForSpectator());
    this.scheduleAwayAutoAction();
  }

  confirmNextHand(socketId) {
    const player = this.findPlayerBySocket(socketId);
    if (!player) return { ok: false, message: 'Unknown player.' };
    return this.confirmNextHandForPlayer(player);
  }

  confirmNextHandForPlayer(player) {
    if (this.phase !== 'handOver') return { ok: false, message: 'Not ready for next hand.' };
    if (this.handOverReady.has(player.seat)) return { ok: true };
    this.handOverReady.add(player.seat);
    this.broadcastLog(`${player.username} is ready for the next hand.`);
    const requiredSeats = this.players.filter((p) => !p.away);
    const allReady = requiredSeats.length > 0 && requiredSeats.every((p) => this.handOverReady.has(p.seat));
    if (allReady) {
      this.startNewHand();
    } else {
      this.rerender();
    }
    return { ok: true };
  }

  // If it's an away player's turn (to play, pass, tribute, return, or confirm the next hand),
  // act on their behalf after a delay so the other three players are never stuck waiting forever.
  scheduleAwayAutoAction() {
    if (this.awayTimer) {
      clearTimeout(this.awayTimer);
      this.awayTimer = null;
    }
    if (this.gameOver || this.phase === 'lobby' || this.phase === 'gameOver') return;

    let actor = null;
    if (this.phase === 'playing' && this.currentTurn !== null) {
      actor = this.players[this.currentTurn];
    } else if (this.phase === 'tribute') {
      const entry = this.pendingTributes.find((item) => !item.cardId);
      if (entry) actor = this.players[entry.from];
    } else if (this.phase === 'return') {
      const entry = this.pendingReturns.find((item) => !item.cardId);
      if (entry) actor = this.players[entry.from];
    } else if (this.phase === 'handOver') {
      actor = this.players.find((p) => p.away && !this.handOverReady.has(p.seat)) || null;
    }

    if (!actor || !actor.away) return;
    const seat = actor.seat;
    this.awayTimer = setTimeout(() => this.performAwayAutoAction(seat), AWAY_AUTO_ACTION_MS);
    if (this.awayTimer.unref) this.awayTimer.unref();
  }

  performAwayAutoAction(seat) {
    this.awayTimer = null;
    const player = this.players[seat];
    if (!player || !player.away) return;

    if (this.phase === 'playing' && this.currentTurn === seat) {
      if (this.lastPlay) {
        this.passForPlayer(player);
      } else if (player.hand.length) {
        this.playCardsForPlayer(player, [player.hand[0].id]);
      }
    } else if (this.phase === 'tribute') {
      const entry = this.pendingTributes.find((item) => item.from === seat && !item.cardId);
      const eligible = entry && player.hand.filter((c) => GuandanRules.isTributeEligible(c, this.currentLevel));
      if (eligible && eligible.length) {
        const maxOrder = Math.max(...eligible.map((c) => GuandanRules.rankOrder(c.rank, this.currentLevel)));
        const pick = eligible.find((c) => GuandanRules.rankOrder(c.rank, this.currentLevel) === maxOrder);
        this.selectTributeForPlayer(player, pick.id);
      }
    } else if (this.phase === 'return') {
      const entry = this.pendingReturns.find((item) => item.from === seat && !item.cardId);
      const eligible = entry && player.hand.filter((c) => GuandanRules.isReturnEligible(c));
      if (eligible && eligible.length) {
        const minOrder = Math.min(...eligible.map((c) => GuandanRules.rankOrder(c.rank, this.currentLevel)));
        const pick = eligible.find((c) => GuandanRules.rankOrder(c.rank, this.currentLevel) === minOrder);
        this.selectReturnForPlayer(player, pick.id);
      }
    } else if (this.phase === 'handOver') {
      this.confirmNextHandForPlayer(player);
    }
  }

  stateFor(viewer) {
    const tribute = this.pendingTributes.find((item) => item.from === viewer.seat && !item.cardId);
    const returnCard = this.pendingReturns.find((item) => item.from === viewer.seat && !item.cardId);
    return {
      code: this.code,
      phase: this.phase,
      handNumber: this.handNumber,
      currentLevel: this.currentLevel,
      teamLevels: this.teamLevels.slice(),
      leadingTeam: this.leadingTeam,
      currentTurn: this.currentTurn,
      currentTurnName: this.currentTurn === null ? null : this.players[this.currentTurn].username,
      canAct: this.currentTurn === viewer.seat,
      lastPlay: this.lastPlay ? {
        username: this.lastPlay.username,
        cards: this.lastPlay.cards,
        title: this.lastPlay.hand.title,
      } : null,
      finishOrder: this.finishOrder.map((seat) => ({
        username: this.players[seat].username,
        seat,
        team: this.players[seat].team,
      })),
      players: this.players.map((p) => ({
        username: p.username,
        seat: p.seat,
        team: p.team,
        cardCount: p.hand.length,
        away: p.away,
        finishedRank: p.finishedRank,
        isSelf: p.seat === viewer.seat,
      })),
      self: {
        username: viewer.username,
        seat: viewer.seat,
        team: viewer.team,
        hand: viewer.hand.map(cloneCard),
        finishedRank: viewer.finishedRank,
      },
      tribute: tribute ? {
        to: tribute.to === null ? '头游/二游' : this.players[tribute.to].username,
        eligible: viewer.hand
          .filter((card) => GuandanRules.isTributeEligible(card, this.currentLevel))
          .map((card) => card.id),
      } : null,
      returnCard: returnCard ? {
        to: this.players[returnCard.to].username,
        eligible: viewer.hand
          .filter((card) => GuandanRules.isReturnEligible(card))
          .map((card) => card.id),
      } : null,
      tributeResult: this.lastTributeResults[viewer.seat] || null,
      handOverReadyCount: this.phase === 'handOver' ? this.handOverReady.size : 0,
      handOverRequiredCount: this.phase === 'handOver' ? this.players.filter((p) => !p.away).length : 0,
      selfReadyForNextHand: this.phase === 'handOver' && this.handOverReady.has(viewer.seat),
      gameOver: this.gameOver,
    };
  }

  // Spectators are not participants: they see every player's hand (for
  // teaching/review purposes) and never get an action prompt of their own.
  stateForSpectator() {
    return {
      code: this.code,
      phase: this.phase,
      handNumber: this.handNumber,
      currentLevel: this.currentLevel,
      teamLevels: this.teamLevels.slice(),
      leadingTeam: this.leadingTeam,
      currentTurn: this.currentTurn,
      currentTurnName: this.currentTurn === null ? null : this.players[this.currentTurn].username,
      lastPlay: this.lastPlay ? {
        username: this.lastPlay.username,
        cards: this.lastPlay.cards,
        title: this.lastPlay.hand.title,
      } : null,
      finishOrder: this.finishOrder.map((seat) => ({
        username: this.players[seat].username,
        seat,
        team: this.players[seat].team,
      })),
      players: this.players.map((p) => ({
        username: p.username,
        seat: p.seat,
        team: p.team,
        cardCount: p.hand.length,
        away: p.away,
        finishedRank: p.finishedRank,
        hand: p.hand.map(cloneCard),
      })),
      gameOver: this.gameOver,
    };
  }
}

module.exports = {
  GuandanGame,
  GuandanRules,
  BASE_RANKS,
};
