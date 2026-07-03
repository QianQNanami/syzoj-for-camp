let User = syzoj.model('user');
let Teacher = syzoj.model('teacher');
const RatingCalculation = syzoj.model('rating_calculation');
const RatingHistory = syzoj.model('rating_history');
const Contest = syzoj.model('contest');
const ContestPlayer = syzoj.model('contest_player');

function normalizeIdList(value) {
  if (!value) return [];
  if (!Array.isArray(value)) value = [value];
  return value.map(id => parseInt(id)).filter(id => !isNaN(id));
}

async function getUserEditData(editedUser, currentUser) {
  let allGroups = null;
  let userGroups = [];
  let allTeachers = [];
  let userTeachers = [];

  if (editedUser) {
    userGroups = (await editedUser.getGroup()).map(g => g.group_id);
  }

  if (editedUser && currentUser && currentUser.is_admin) {
    allGroups = await syzoj.model('group').find();
    allTeachers = await Teacher.find({
      order: { name: 'ASC' }
    });

    if (editedUser.user_type === 'student') {
      userTeachers = (await editedUser.getTeacher()).map(x => x.teacher_id);
    }
  }

  return {
    allGroups,
    userGroups,
    allTeachers,
    userTeachers
  };
}

// Ranklist
app.get('/ranklist', async (req, res) => {
  try {
    const sort = req.query.sort || syzoj.config.sorting.ranklist.field;
    const order = req.query.order || syzoj.config.sorting.ranklist.order;
    if (!['ac_num', 'rating', 'id', 'username'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }
    const where = { is_show: true, user_type: 'student' };
    let paginate = syzoj.utils.paginate(await User.countForPagination(where), req.query.page, syzoj.config.page.ranklist);
    let ranklist = await User.queryPage(paginate, where, { [sort]: order.toUpperCase() });
    await ranklist.forEachAsync(async x => x.renderInformation());

    res.render('ranklist', {
      ranklist: ranklist,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// 贡榜：仅登录的非学生用户可见，只展示 lecturer 用户的排名
app.get('/gongbang', async (req, res) => {
  try {
    if (!res.locals.user || res.locals.user.user_type === 'student') {
      throw new ErrorMessage('您没有权限查看此页面。');
    }

    const sort = req.query.sort || syzoj.config.sorting.ranklist.field;
    const order = req.query.order || syzoj.config.sorting.ranklist.order;
    if (!['ac_num', 'rating', 'id', 'username'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    const where = { is_show: true, user_type: 'lecturer' };
    let paginate = syzoj.utils.paginate(await User.countForPagination(where), req.query.page, syzoj.config.page.ranklist);
    let ranklist = await User.queryPage(paginate, where, { [sort]: order.toUpperCase() });
    await ranklist.forEachAsync(async x => x.renderInformation());

    res.render('gongbang', {
      ranklist: ranklist,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/find_user', async (req, res) => {
  try {
    let user = await User.fromName(req.query.nickname);
    if (!user) throw new ErrorMessage('无此用户。');
    res.redirect(syzoj.utils.makeUrl(['user', user.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/find_realname', async (req, res) => {
    try {
      let user = await User.fromRealName(req.query.realname);
      if (!user) throw new ErrorMessage('无此用户。');
      res.redirect(syzoj.utils.makeUrl(['user', user.id]));
    } catch (e) {
      syzoj.log(e);
      res.render('error', {
        err: e
      });
    }
  });

// Login
app.get('/login', async (req, res) => {
  if (res.locals.user) {
    res.render('error', {
      err: new ErrorMessage('您已经登录了，请先注销。', { '注销': syzoj.utils.makeUrl(['logout'], { 'url': req.originalUrl }) })
    });
  } else {
    res.render('login');
  }
});

// Sign up
app.get('/sign_up', async (req, res) => {
  res.render('error', {
    err: new ErrorMessage('不允许注册。请联系管理员。')
  });
//   if (res.locals.user) {
//     res.render('error', {
//       err: new ErrorMessage('您已经登录了，请先注销。', { '注销': syzoj.utils.makeUrl(['logout'], { 'url': req.originalUrl }) })
//     });
//   } else {
//     res.render('sign_up');
//   }
});

// Logout
app.post('/logout', async (req, res) => {
  req.session.user_id = null;
  res.clearCookie('login');
  res.redirect(req.query.url || '/');
});

// User page
app.get('/user/:id', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');
    user.ac_problems = await user.getACProblems();
    user.articles = await user.getArticles();
    user.allowedEdit = await user.isAllowedEditBy(res.locals.user);

    let statistics = await user.getStatistics();
    await user.renderInformation();
    user.emailVisible = user.public_email || user.allowedEdit;

    let userGroups = await user.getGroup();
    let groupIds = userGroups.map(g => g.group_id);
    let groupNames = "";
    if (groupIds.length > 0) {
      let groups = await syzoj.model('group').createQueryBuilder('group')
        .where('group.group_id IN (:...ids)', { ids: groupIds })
        .getMany();
      groupNames = groups.map(g => g.group_name).join(', ');
    }

    let teachers = [];
    if (user.allowedEdit && user.user_type === 'student') {
      let userTeachers = await user.getTeacher();
      teachers = (await userTeachers.mapAsync(async x => await Teacher.findById(x.teacher_id))).filter(x => x);
      teachers.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }

    const ratingHistoryValues = await RatingHistory.find({
      where: { user_id: user.id },
      order: { rating_calculation_id: 'ASC' }
    });
    const ratingHistories = [{
      contestName: "初始积分",
      value: syzoj.config.default.user.rating,
      delta: null,
      rank: null
    }];

    for (const history of ratingHistoryValues) {
      const calculation = await RatingCalculation.findById(history.rating_calculation_id);
      let contestName = calculation.poker_name;
      let participants = 0;
      if (calculation.contest_id) {
        const contest = await Contest.findById(calculation.contest_id);
        contestName = contest.title;
        participants = await ContestPlayer.count({ contest_id: contest.id });
      } else if (history.poker_hand) {
        contestName = `${contestName} - ${history.poker_hand}`;
      }

      ratingHistories.push({
        contestName: contestName,
        value: history.rating_after,
        delta: history.rating_after - ratingHistories[ratingHistories.length - 1].value,
        rank: history.rank,
        participants: participants
      });
    }
    ratingHistories.reverse();

    res.render('user', {
      show_user: user,
      statistics: statistics,
      ratingHistories: ratingHistories,
      groupNames: groupNames,
      teachers: teachers
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/user/:id/edit', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let allowedEdit = await user.isAllowedEditBy(res.locals.user);
    if (!allowedEdit) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    user.privileges = await user.getPrivileges();

    res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');

    let editData = await getUserEditData(user, res.locals.user);

    res.render('user_edit', Object.assign({
      edited_user: user,
      error_info: null,
      force_change: req.query.force_change === '1'
    }, editData));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/forget', async (req, res) => {
  res.render('forget');
});



app.post('/user/:id/edit', async (req, res) => {
  let user;
  try {
    let id = parseInt(req.params.id);
    user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let allowedEdit = await user.isAllowedEditBy(res.locals.user);
    if (!allowedEdit) throw new ErrorMessage('您没有权限进行此操作。');

    if (req.body.new_password) {
      const isSelfChange = res.locals.user && res.locals.user.id === user.id;
      if (isSelfChange && user.user_type === 'student') {
        throw new ErrorMessage('学生账号不允许自行修改密码。');
      }
      if (req.body.old_password) {
        if (user.password !== req.body.old_password && !await res.locals.user.hasPrivilege('manage_user')) throw new ErrorMessage('旧密码错误。');
      } else if (!await res.locals.user.hasPrivilege('manage_user')) {
        throw new ErrorMessage('请输入旧密码。');
      }
      user.password = req.body.new_password;
      user.must_change_password = false;
    }

    if (res.locals.user && await res.locals.user.hasPrivilege('manage_user')) {
      if (!syzoj.utils.isValidUsername(req.body.username)) throw new ErrorMessage('无效的用户名。');
      user.username = req.body.username;
      user.email = req.body.email;
    }

    if (res.locals.user && res.locals.user.is_admin) {
      if (!req.body.privileges) {
        req.body.privileges = [];
      } else if (!Array.isArray(req.body.privileges)) {
        req.body.privileges = [req.body.privileges];
      }

      let privileges = req.body.privileges;
      await user.setPrivileges(privileges);

      await user.setGroup(normalizeIdList(req.body.groups));

      if (user.user_type === 'student') {
        await user.setTeacher(normalizeIdList(req.body.teachers));
      }
    }

    if ((req.body.information || '') !== (user.information || '')) {
      if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_user')) {
        throw new ErrorMessage('您没有权限修改个性签名。');
      }
      user.information = req.body.information;
    }
    user.sex = req.body.sex;
    user.public_email = (req.body.public_email === 'on');
    user.prefer_formatted_code = (req.body.prefer_formatted_code === 'on');

    if (res.locals.user && await res.locals.user.hasPrivilege('manage_user')) {
      user.realname = req.body.realname;
      user.school = req.body.school;
      user.seat = req.body.seat;
    }

    await user.save();

    if (user.id === res.locals.user.id) res.locals.user = user;

    user.privileges = await user.getPrivileges();
    res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');

    let editData = await getUserEditData(user, res.locals.user);

    res.render('user_edit', Object.assign({
      edited_user: user,
      error_info: '',
      force_change: false
    }, editData));
  } catch (e) {
    if (!user) {
      syzoj.log(e);
      res.render('error', {
        err: e
      });
      return;
    }

    try {
      user.privileges = await user.getPrivileges();
      if (res.locals.user)
        res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');
    } catch (e) {
      console.error(e);
    }

    let editData = await getUserEditData(user, res.locals.user);

    res.render('user_edit', Object.assign({
      edited_user: user,
      error_info: e.message,
      force_change: req.query.force_change === '1'
    }, editData));
  }
});
