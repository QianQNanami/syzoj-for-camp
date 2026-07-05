const { initializePoker } = require('./poker_socket');

app.get('/poker', async (req, res) => {
  try {
    if (!res.locals.user) {
      return res.redirect(syzoj.utils.makeUrl(['login'], { url: req.originalUrl }));
    }

    if (!res.locals.user.is_admin && res.locals.user.user_type !== 'admin' && res.locals.user.user_type !== 'lecturer') {
      throw new Error('Permission Denied');
    }
    
    res.render('poker', {
        title: "德州OI"
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
