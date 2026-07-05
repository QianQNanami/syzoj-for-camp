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
  assert(hand, '2 is a normal low card and can be the bottom of a straight');
  assert.strictEqual(hand.type, 'straight');

  hand = GuandanRules.evaluate([
    card('A', 'S'),
    card('2', 'H'),
    card('3', 'D'),
    card('4', 'C'),
    card('5', 'S'),
  ], '7');
  assert(hand, 'A-2-3-4-5 (the wheel) should be a legal, and the lowest, straight');
  assert.strictEqual(hand.type, 'straight');
  const wheelPrimary = hand.primary;

  hand = GuandanRules.evaluate([
    card('2', 'S'),
    card('3', 'H'),
    card('4', 'D'),
    card('5', 'C'),
    card('6', 'S'),
  ], '7');
  assert(hand.primary > wheelPrimary, '2-3-4-5-6 should rank above the wheel A-2-3-4-5');

  hand = GuandanRules.evaluate([
    card('10', 'S'),
    card('J', 'H'),
    card('Q', 'D'),
    card('K', 'C'),
    card('A', 'S'),
  ], '7');
  assert(hand, '10-J-Q-K-A should still be a legal straight (Ace as the normal high card)');
  assert.strictEqual(hand.type, 'straight');
  assert(hand.primary > wheelPrimary, '10-J-Q-K-A should rank as the highest straight, above the wheel');

  hand = GuandanRules.evaluate([
    card('K', 'S'),
    card('A', 'H'),
    card('2', 'D'),
    card('3', 'C'),
    card('4', 'S'),
  ], '7');
  assert.strictEqual(hand, null, 'K-A-2-3-4 should not wrap around; only A-2-3-4-5 and 10-J-Q-K-A touch the Ace');

  hand = GuandanRules.evaluate([card('BJ', 'J', 0), card('BJ', 'J', 1)], '7');
  assert(hand, 'two big jokers should be a valid pair');
  assert.strictEqual(hand.type, 'pair');
}

function testAmbiguousWildcardInterpretationsAreAllSurfaced() {
  // 4,5,6,7 plus a red-heart K wildcard can complete either 3-4-5-6-7 or
  // 4-5-6-7-8: both are legal, and which one to use is the player's choice.
  const cards = [card('4', 'S'), card('5', 'C'), card('6', 'D'), card('7', 'S'), card('K', 'H')];
  const options = GuandanRules.evaluateOptions(cards, 'K');
  assert.strictEqual(options.length, 2, 'both straight completions should be offered');
  assert(options.every((o) => o.type === 'straight'));
  const primaries = options.map((o) => o.primary).sort((a, b) => a - b);
  assert.strictEqual(primaries[0], GuandanRules.straightHigh(['3', '4', '5', '6', '7']));
  assert.strictEqual(primaries[1], GuandanRules.straightHigh(['4', '5', '6', '7', '8']));

  // evaluate() (used by anything that doesn't care about the ambiguity,
  // e.g. bomb detection) should still deterministically pick the strongest.
  const best = GuandanRules.evaluate(cards, 'K');
  assert.strictEqual(best.primary, primaries[1]);

  // A hand with only one legal interpretation should not force a choice.
  const unambiguous = GuandanRules.evaluateOptions([card('9', 'S'), card('9', 'H')], 'K');
  assert.strictEqual(unambiguous.length, 1);
}

function testPlayCardsRequiresChoiceOnAmbiguousPattern() {
  const game = makeGame();
  game.phase = 'playing';
  game.currentLevel = 'K';
  game.currentTurn = 0;
  const ids = ['0-S-4', '0-C-5', '0-D-6', '0-S-7', '0-H-K'];
  game.players[0].hand = [card('4', 'S'), card('5', 'C'), card('6', 'D'), card('7', 'S'), card('K', 'H')];

  const withoutChoice = game.playCardsForPlayer(game.players[0], ids);
  assert.strictEqual(withoutChoice.ok, false);
  assert.strictEqual(withoutChoice.needsChoice, true, 'an ambiguous play should ask the player to choose, not auto-pick');
  assert.strictEqual(withoutChoice.options.length, 2);
  assert.strictEqual(game.players[0].hand.length, 5, 'an ambiguous attempt must not consume any cards');

  const lowChoice = withoutChoice.options.find((o) => o.assignedRanks[0] === '3');
  const withChoice = game.playCardsForPlayer(game.players[0], ids, {
    type: lowChoice.type, size: lowChoice.size, primary: lowChoice.primary,
  });
  assert.strictEqual(withChoice.ok, true);
  assert.strictEqual(game.lastPlay.hand.primary, lowChoice.primary, 'the player-chosen interpretation should be used, not the strongest one');
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
  assert.strictEqual(game.teamLevels[0], '6', 'double-up should advance four levels from 2 to 6');

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

function testTributeShapeSelection() {
  // team = seat % 2, so team 0 = {seat 0, seat 2}, team 1 = {seat 1, seat 3}.

  // 1st & 2nd same team (双上): no tribute at all.
  let game = makeGame();
  game.previousFinishOrder = [0, 2, 1, 3];
  game.handNumber = 2;
  game.setupTribute();
  assert.strictEqual(game.phase, 'playing', 'double-up should skip tribute entirely');
  assert.strictEqual(game.currentTurn, 0, '1st place leads directly after a double-up');

  // 1st & 3rd same team (双下): both the 2nd and 4th place players tribute.
  game = makeGame();
  game.previousFinishOrder = [0, 1, 2, 3];
  game.handNumber = 2;
  game.players[1].hand = [card('3', 'S', 0)];
  game.players[3].hand = [card('4', 'S', 0)];
  game.setupTribute();
  assert.strictEqual(game.phase, 'tribute', '双下 should proceed to a tribute with two givers');
  assert.strictEqual(game.pendingTributes.length, 2, '双下 needs both the 2nd and 4th place players to tribute');
  assert.deepStrictEqual(game.pendingTributes.map((t) => t.from).sort(), [1, 3], '2nd and 4th place are the givers');
  assert.deepStrictEqual(game.tributeRecipients, [0, 2], '1st and 3rd place (the winning team) are the recipients');

  // 1st & 4th same team (单下): only the 4th place player tributes, to 1st place,
  // even though they're teammates.
  game = makeGame();
  game.previousFinishOrder = [0, 1, 3, 2];
  game.handNumber = 2;
  game.players[2].hand = [card('4', 'S', 0)];
  game.setupTribute();
  assert.strictEqual(game.phase, 'tribute', '单下 should proceed to a single-giver tribute');
  assert.strictEqual(game.pendingTributes.length, 1, '单下 only requires the 4th place player to tribute');
  assert.strictEqual(game.pendingTributes[0].from, 2, '4th place is the sole giver');
  assert.strictEqual(game.pendingTributes[0].to, 0, 'the tribute goes to 1st place');
}

function testAntiTributeCollectiveBigJokersAcrossGivers() {
  // 双下 shape (1st & 3rd same team) so there are two givers to split jokers across.
  let game = makeGame();
  game.previousFinishOrder = [0, 1, 2, 3];
  game.handNumber = 2;
  game.players[1].hand = [card('BJ', 'J', 0), card('3', 'S', 0)];
  game.players[3].hand = [card('BJ', 'J', 1), card('4', 'S', 0)];
  game.setupTribute();
  assert.strictEqual(game.phase, 'playing', 'big jokers split one-each across the two givers should still trigger anti-tribute');
  assert.strictEqual(game.currentTurn, 0, 'anti-tribute leads with 1st place');

  game = makeGame();
  game.previousFinishOrder = [0, 1, 2, 3];
  game.handNumber = 2;
  game.players[1].hand = [card('BJ', 'J', 0), card('BJ', 'J', 1), card('3', 'S', 0)];
  game.players[3].hand = [card('4', 'S', 0)];
  game.setupTribute();
  assert.strictEqual(game.phase, 'playing', 'one tribute player holding both big jokers should trigger anti-tribute');

  game = makeGame();
  game.previousFinishOrder = [0, 1, 2, 3];
  game.handNumber = 2;
  game.players[1].hand = [card('3', 'S', 0)];
  game.players[3].hand = [card('4', 'S', 0)];
  game.setupTribute();
  assert.strictEqual(game.phase, 'tribute', 'no big jokers among the givers should proceed to a normal tribute');
}

function testTrickWinnerLeadsNextTrick() {
  const game = makeGame();
  game.lastPlay = { player: 0, username: 'a', cards: [], hand: { type: 'single', size: 1, primary: 5 } };
  assert.strictEqual(game.nextLeadAfterTrick(), 0, 'the trick winner should lead the next trick, not their teammate');

  game.players[0].finishedRank = 1;
  assert.strictEqual(game.nextLeadAfterTrick(), 2, "if the winner already finished, their teammate leads instead");
}

function testTributeGiverLeadsAfterReturn() {
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
  assert.strictEqual(game.currentTurn, 3, 'the tribute giver should lead the first trick, not the tribute receiver');
}

function testBiggerTributeGiverLeadsInDoubleTribute() {
  const game = makeGame();
  game.currentLevel = '2';
  const lowTribute = card('10', 'S', 0);
  const highTribute = card('A', 'S', 0);
  game.players[1].hand = [lowTribute, card('3', 'S', 0)];
  game.players[3].hand = [highTribute, card('4', 'S', 0)];
  game.players[0].hand = [card('5', 'H', 0)];
  game.players[2].hand = [card('6', 'H', 0)];
  game.pendingTributes = [
    { from: 1, to: null, cardId: lowTribute.id },
    { from: 3, to: null, cardId: highTribute.id },
  ];
  game.tributeRecipients = [0, 2];

  game.applyTributes();
  for (const item of game.pendingReturns) item.cardId = game.players[item.from].hand[0].id;
  game.applyReturns();
  assert.strictEqual(game.currentTurn, 3, 'whoever gave the bigger tribute card leads, regardless of rank');
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

function testDoubleUpEndsHandImmediately() {
  const game = makeGame();
  game.phase = 'playing';
  game.currentTurn = 0;
  game.players[0].hand = [card('3', 'S', 0)];
  const r1 = game.playCardsForPlayer(game.players[0], [game.players[0].hand[0].id]);
  assert(r1.ok);
  assert.strictEqual(game.finishOrder.length, 1, 'only the first player has finished so far');
  assert.strictEqual(game.phase, 'playing', 'hand should not end after a single finisher');

  // Seat 2 is seat 0's teammate (team = seat % 2). Simulate them leading and
  // finishing next, producing a 双上 (double-up).
  game.currentTurn = 2;
  game.lastPlay = null;
  game.players[2].hand = [card('4', 'S', 0)];
  const r2 = game.playCardsForPlayer(game.players[2], [game.players[2].hand[0].id]);
  assert(r2.ok);
  assert.strictEqual(game.finishOrder.length, 4, 'double-up should immediately auto-finish all 4 players');
  assert.strictEqual(game.phase, 'handOver', 'the hand should end immediately on double-up, not keep playing');
  assert.strictEqual(game.players[0].finishedRank, 1);
  assert.strictEqual(game.players[2].finishedRank, 2);
  assert.strictEqual(game.teamLevels[0], '6', 'double-up should still advance the winning team four levels');
}

testPatterns();
testAmbiguousWildcardInterpretationsAreAllSurfaced();
testPlayCardsRequiresChoiceOnAmbiguousPattern();
testBombComparison();
testHandSettlement();
testDoubleTributeAssignment();
testTributeShapeSelection();
testAntiTributeCollectiveBigJokersAcrossGivers();
testTrickWinnerLeadsNextTrick();
testTributeGiverLeadsAfterReturn();
testBiggerTributeGiverLeadsInDoubleTribute();
testTributeGiverSeesResolvedRecipient();
testHandOverRequiresAllPresentPlayersToConfirm();
testAwayPlayerAutoPlaysOrPasses();
testAwayPlayerAutoTributeAndReturn();
testDoubleUpEndsHandImmediately();

console.log('guandan rules tests passed');
