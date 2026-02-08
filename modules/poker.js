app.get('/poker', async (req, res) => {
  try {
    if (!res.locals.user) {
      return res.redirect(syzoj.utils.makeUrl(['login'], { url: req.originalUrl }));
    }
    const isLecturer = res.locals.user.user_type === 'lecturer';
    const isAdmin = res.locals.user.is_admin;
    if (!isAdmin && !isLecturer) {
      throw new Error('Permission Denied');
    }

    res.render('poker', {
      poker_url: `http://${req.hostname}:8080?username=${res.locals.user.username}`
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/api/poker/update_rating', async (req, res) => {
  try {
    const { username, rating_change, token } = req.body;
    if (token !== syzoj.config.judge_token) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const User = syzoj.model('user');
    const user = await User.fromName(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.rating = (user.rating || 0) + parseInt(rating_change);
    await user.save();

    res.json({ success: true, new_rating: user.rating });
  } catch (e) {
    syzoj.log(e);
    res.status(500).json({ error: e.message });
  }
});
