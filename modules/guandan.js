app.get('/guandan', async (req, res) => {
  try {
    if (!res.locals.user) {
      return res.redirect(syzoj.utils.makeUrl(['login'], { url: req.originalUrl }));
    }

    if (!res.locals.user.is_admin && res.locals.user.user_type !== 'admin' && res.locals.user.user_type !== 'lecturer') {
      throw new Error('Permission Denied');
    }

    res.render('guandan', {
      title: '淮安OI'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
