const assert = require('assert');
const { GuandanGame, GuandanRules } = require('../classes/guandan_game');

function card(rank, suit, deck) {
  const joker = rank === 'SJ' ? 'small' : (rank === 'BJ' ? 'big' : null);
  return {
    id: `${deck || 0}-${suit}-${rank}`,
    rank,
    suit,
    deck: deck || 0,
    label: rank === 'SJ' ? '小王' : (rank === 'BJ' ? '大王' : rank),
    suitLabel: suit === 'S' ? '♠' : (suit === 'H' ? '♥' : (suit === 'D' ? '♦' : (suit === 'C' ? '♣' : ''))),
    joker,
  };
}

function makeGame() {
  const game = new GuandanGame('1000', 'a');
  ['a', 'b', 'c', 'd'].forEach((name, index) => {
    game.players.push({
      username: name,
      socket: null,
      seat: index,
      team: index % 2,
      hand: [],
      away: false,
      finishedRank: null,
    });
  });
  return game;
}

function testPatterns() {
  let hand = GuandanRules.evaluate([card('7', 'S'), card('5', 'H')], '5');
  assert(hand, 'red heart level should act as a wildcard');
  assert.strictEqual(hand.type, 'pair');
  assert.strictEqual(hand.primary, GuandanRules.rankOrder('7', '5'));

  hand = GuandanRules.evaluate([
    card('3', 'S'),
    card('4', 'S'),
    card('5', 'H'),
    card('6', 'S'),
    card('7', 'S'),
  ], '5');
  assert(hand, 'wildcard should complete a straight flush');
  assert.strictEqual(hand.type, 'straightFlush');

  hand = GuandanRules.evaluate([
    card('2', 'S'),
    card('3', 'H'),
    card('4', 'D'),
    card('5', 'C'),
    card('6', 'S'),
  ], '7');
  assert.strictEqual(hand, null, '2 cannot be used in a straight');

  hand = GuandanRules.evaluate([card('BJ', 'J', 0), card('BJ', 'J', 1)], '7');
  assert(hand, 'two big jokers should be a valid pair');
  assert.strictEqual(hand.type, 'pair');
}

function testBombComparison() {
  const straightFlush = GuandanRules.evaluate([
    card('6', 'S'),
    card('7', 'S'),
    card('8', 'S'),
    card('9', 'S'),
    card('10', 'S'),
  ], '2');
  const fiveBomb = GuandanRules.evaluate([
    card('9', 'S', 0),
    card('9', 'H', 0),
    card('9', 'D', 0),
    card('9', 'C', 0),
    card('9', 'S', 1),
  ], '2');
  const sixBomb = GuandanRules.evaluate([
    card('8', 'S', 0),
    card('8', 'H', 0),
    card('8', 'D', 0),
    card('8', 'C', 0),
    card('8', 'S', 1),
    card('8', 'H', 1),
  ], '2');
  const kingBomb = GuandanRules.evaluate([
    card('SJ', 'J', 0),
    card('SJ', 'J', 1),
    card('BJ', 'J', 0),
    card('BJ', 'J', 1),
  ], '2');

  assert.strictEqual(straightFlush.type, 'straightFlush');
  assert.strictEqual(fiveBomb.type, 'bomb');
  assert.strictEqual(sixBomb.type, 'bomb');
  assert.strictEqual(kingBomb.type, 'kingBomb');
  assert(GuandanRules.canBeat(straightFlush, fiveBomb), 'straight flush should beat a five-card bomb');
  assert(!GuandanRules.canBeat(straightFlush, sixBomb), 'straight flush should not beat a six-card bomb');
  assert(GuandanRules.canBeat(kingBomb, sixBomb), 'king bomb should beat every other bomb');
}

function testHandSettlement() {
  let game = makeGame();
  game.finishOrder = [0, 2, 1, 3];
  game.phase = 'playing';
  game.endHand();
  assert.strictEqual(game.teamLevels[0], '5', 'double-up should advance three levels from 2 to 5');

  game = makeGame();
  game.finishOrder = [0, 1, 2, 3];
  game.phase = 'playing';
  game.endHand();
  assert.strictEqual(game.teamLevels[0], '4', '1/3 should advance two levels from 2 to 4');

  game = makeGame();
  game.finishOrder = [0, 1, 3, 2];
  game.phase = 'playing';
  game.endHand();
  assert.strictEqual(game.teamLevels[0], '3', '1/4 should advance one level from 2 to 3');

  game = makeGame();
  game.teamLevels[0] = 'A';
  game.finishOrder = [0, 2, 1, 3];
  game.phase = 'playing';
  game.endHand();
  assert.strictEqual(game.phase, 'gameOver', 'A-level double-up should finish the match');
}

function testDoubleTributeAssignment() {
  const game = makeGame();
  game.currentLevel = '2';
  const lowTribute = card('10', 'S', 0);
  const highTribute = card('A', 'S', 0);
  game.players[1].hand = [lowTribute, card('3', 'S', 0)];
  game.players[3].hand = [highTribute, card('4', 'S', 0)];
  game.pendingTributes = [
    { from: 1, to: null, cardId: lowTribute.id },
    { from: 3, to: null, cardId: highTribute.id },
  ];
  game.tributeRecipients = [0, 2];

  game.applyTributes();

  assert(game.players[0].hand.some((c) => c.id === highTribute.id), 'higher tribute should go to first place');
  assert(game.players[2].hand.some((c) => c.id === lowTribute.id), 'lower tribute should go to second place');
}

function testAntiTributeNeedsSamePlayerDoubleBigJokers() {
  const game = makeGame();
  game.previousFinishOrder = [0, 2, 1, 3];
  game.handNumber = 2;
  game.players[1].hand = [card('BJ', 'J', 0), card('3', 'S', 0)];
  game.players[3].hand = [card('BJ', 'J', 1), card('4', 'S', 0)];
  game.setupTribute();
  assert.strictEqual(game.phase, 'tribute', 'split big jokers across two players should not trigger anti-tribute');

  game.players[1].hand = [card('BJ', 'J', 0), card('BJ', 'J', 1), card('3', 'S', 0)];
  game.players[3].hand = [card('4', 'S', 0)];
  game.setupTribute();
  assert.strictEqual(game.phase, 'playing', 'one tribute player with two big jokers should trigger anti-tribute');
}

function testTrickWinnerLeadsNextTrick() {
  const game = makeGame();
  game.lastPlay = { player: 0, username: 'a', cards: [], hand: { type: 'single', size: 1, primary: 5 } };
  assert.strictEqual(game.nextLeadAfterTrick(), 0, 'the trick winner should lead the next trick, not their teammate');

  game.players[0].finishedRank = 1;
  assert.strictEqual(game.nextLeadAfterTrick(), 2, "if the winner already finished, their teammate leads instead");
}

function testTributeReceiverLeadsAfterReturn() {
  const game = makeGame();
  game.currentLevel = '2';
  const tributeCard = card('A', 'S', 0);
  game.players[3].hand = [tributeCard, card('6', 'S', 0)];
  game.players[0].hand = [card('4', 'H', 0)];
  game.pendingTributes = [{ from: 3, to: 0, cardId: tributeCard.id }];
  game.tributeRecipients = [0];
  game.applyTributes();
  const entry = game.pendingReturns.find((item) => item.from === 0);
  entry.cardId = game.players[0].hand[0].id;
  game.applyReturns();
  assert.strictEqual(game.currentTurn, 0, 'the tribute receiver should lead the first trick, not the tribute giver');
}

function testTributeGiverSeesResolvedRecipient() {
  const game = makeGame();
  game.currentLevel = '2';
  const tributeCard = card('A', 'S', 0);
  game.players[3].hand = [tributeCard, card('6', 'S', 0)];
  game.players[0].hand = [card('4', 'H', 0)];
  game.pendingTributes = [{ from: 3, to: 0, cardId: tributeCard.id }];
  game.tributeRecipients = [0];
  game.applyTributes();
  assert.deepStrictEqual(
    game.lastTributeResults[3],
    { toUsername: 'a', cardText: 'A♠' },
    'the tribute giver should be told who received their card and which card it was'
  );
}

function testHandOverRequiresAllPresentPlayersToConfirm() {
  const game = makeGame();
  game.phase = 'handOver';
  game.finishOrder = [0, 1, 2, 3];
  game.players[3].away = true;

  const r1 = game.confirmNextHandForPlayer(game.players[0]);
  assert(r1.ok);
  assert.strictEqual(game.phase, 'handOver', 'should not start the next hand until everyone present has confirmed');

  game.confirmNextHandForPlayer(game.players[1]);
  assert.strictEqual(game.phase, 'handOver', 'still waiting on player 2');

  game.confirmNextHandForPlayer(game.players[2]);
  assert.strictEqual(game.phase, 'playing', 'the away player should not block the next hand from starting');
}

function testAwayPlayerAutoPlaysOrPasses() {
  let game = makeGame();
  game.phase = 'playing';
  game.currentTurn = 0;
  game.players[0].away = true;
  game.players[0].hand = [card('4', 'S', 0), card('9', 'H', 0)];
  game.performAwayAutoAction(0);
  assert.strictEqual(game.players[0].hand.length, 1, 'an away leader should auto-play their lowest card');
  assert(game.lastPlay && game.lastPlay.player === 0);

  game = makeGame();
  game.phase = 'playing';
  game.currentTurn = 1;
  game.players[1].away = true;
  game.lastPlay = { player: 0, username: 'a', cards: [], hand: { type: 'single', size: 1, primary: 5 } };
  game.performAwayAutoAction(1);
  assert.strictEqual(game.currentTurn, 2, 'an away player who cannot beat the lead should auto-pass');
}

function testAwayPlayerAutoTributeAndReturn() {
  const game = makeGame();
  game.currentLevel = '2';
  game.phase = 'tribute';
  game.players[3].away = true;
  const highCard = card('A', 'S', 0);
  game.players[3].hand = [card('6', 'S', 0), highCard];
  game.players[0].hand = [card('7', 'H', 0)];
  game.pendingTributes = [{ from: 3, to: 0, cardId: null }];
  game.tributeRecipients = [0];
  game.performAwayAutoAction(3);
  assert.strictEqual(game.phase, 'return', 'an away tribute-giver should auto-tribute their highest eligible card');
  assert(game.players[0].hand.some((c) => c.id === highCard.id));

  game.players[0].away = true;
  const lowCard = game.players[0].hand.find((c) => c.rank !== 'A');
  game.performAwayAutoAction(0);
  assert.strictEqual(game.phase, 'playing', 'an away return-giver should auto-return their lowest eligible card');
  assert(game.players[3].hand.some((c) => c.id === lowCard.id));
}

testPatterns();
testBombComparison();
testHandSettlement();
testDoubleTributeAssignment();
testAntiTributeNeedsSamePlayerDoubleBigJokers();
testTrickWinnerLeadsNextTrick();
testTributeReceiverLeadsAfterReturn();
testTributeGiverSeesResolvedRecipient();
testHandOverRequiresAllPresentPlayersToConfirm();
testAwayPlayerAutoPlaysOrPasses();
testAwayPlayerAutoTributeAndReturn();

console.log('guandan rules tests passed');
