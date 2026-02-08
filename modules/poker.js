const { initializePoker } = require('./poker_socket');

app.get('/poker', async (req, res) => {
  try {
    if (!res.locals.user) {
      return res.redirect(syzoj.utils.makeUrl(['login'], { url: req.originalUrl }));
    }
    
    res.render('poker', {
        title: "Texas Hold'em Poker"
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
