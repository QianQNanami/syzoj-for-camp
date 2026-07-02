let Contest = syzoj.model('contest');
let ContestRanklist = syzoj.model('contest_ranklist');
let ContestPlayer = syzoj.model('contest_player');
let Problem = syzoj.model('problem');
let JudgeState = syzoj.model('judge_state');
let User = syzoj.model('user');
let UserTeacher = syzoj.model('user-teacher');
let Teacher = syzoj.model('teacher');

const jwt = require('jsonwebtoken');
const Email = require('../libs/email');
const { getSubmissionInfo, getRoughResult, processOverallResult } = require('../libs/submissions_process');

const contestEmailTasks = {};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvCell(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/,/g, '，');
}

function isEmailTaskRunning(task) {
  return task && (task.status === 'pending' || task.status === 'running');
}

function getRunningEmailTask(contestId) {
  return Object.values(contestEmailTasks).find(task => task.contest_id === contestId && isEmailTaskRunning(task));
}

function formatContestProblemResult(contest, player, problem) {
  const detail = player.score_details && player.score_details[problem.id];
  if (!detail) return '';

  if (contest.type === 'acm') {
    if (detail.accepted) {
      const count = detail.unacceptedCount ? detail.unacceptedCount : '';
      return `+${count} ${syzoj.utils.formatTime(detail.acceptedTime - contest.start_time)}`;
    }
    if (detail.unacceptedCount) return `-${detail.unacceptedCount}`;
    return '';
  }

  if (detail.weighted_score != null) return Math.round(detail.weighted_score);
  return 0;
}

async function buildContestScoreData(contest) {
  await contest.loadRelationships();
  const problems_id = await contest.getProblems();
  const problems = (await problems_id.mapAsync(async id => await Problem.findById(id))).filter(x => x);
  const players_id = [];
  if (contest.ranklist && contest.ranklist.ranklist) {
    for (let i = 1; i <= contest.ranklist.ranklist.player_num; i++) players_id.push(contest.ranklist.ranklist[i]);
  }

  const ranklist = (await players_id.mapAsync(async player_id => {
    const player = await ContestPlayer.findById(player_id);
    if (!player) return null;
    if (!player.score_details) player.score_details = {};

    if (contest.type === 'noi' || contest.type === 'ioi') {
      player.score = 0;
    }

    for (let i in player.score_details) {
      player.score_details[i].judge_state = await JudgeState.findById(player.score_details[i].judge_id);
      if (contest.type === 'noi' || contest.type === 'ioi') {
        let multiplier = (contest.ranklist.ranking_params || {})[i] || 1.0;
        player.score_details[i].weighted_score = player.score_details[i].score == null ? null : Math.round(player.score_details[i].score * multiplier);
        player.score += player.score_details[i].weighted_score;
      }
    }

    const user = await User.findById(player.user_id);
    return { user, player };
  })).filter(item => item && item.user);

  const byUserId = {};
  let rank = 0, lastItem = null;
  for (let i = 0; i < ranklist.length; i++) {
    const item = ranklist[i];

    if (contest.type === 'noi' || contest.type === 'ioi') {
      if (i === 0 || item.player.score !== lastItem.player.score) rank = i + 1;
    } else {
      let timeSum = 0;
      for (let problem of problems) {
        if (item.player.score_details[problem.id] && item.player.score_details[problem.id].accepted) {
          timeSum += (item.player.score_details[problem.id].acceptedTime - contest.start_time) + (item.player.score_details[problem.id].unacceptedCount * 20 * 60);
        }
      }
      item.player.timeSum = timeSum;
      if (i === 0 || item.player.score !== lastItem.player.score || item.player.timeSum !== lastItem.player.timeSum) rank = i + 1;
    }

    item.rank = rank;
    item.problemResults = problems.map(problem => formatContestProblemResult(contest, item.player, problem));
    byUserId[item.user.id] = item;
    lastItem = item;
  }

  return { problems, byUserId };
}

function buildTeacherReportBody(contest, teacher, students, scoreData) {
  const lines = [];
  lines.push(`比赛标题：${contest.title}`);
  lines.push(`教师：${teacher.name}`);
  lines.push(`发送时间：${syzoj.utils.formatDate(syzoj.utils.getCurrentDate())}`);
  lines.push('');

  const problemHeaders = scoreData.problems.map((problem, i) => csvCell(problem && syzoj.utils.removeTitleTag(problem.title || `P${i + 1}`) || `P${i + 1}`));
  if (contest.type === 'acm') {
    lines.push(['排名', '用户名', '姓名', '状态', '通过数量', '罚时'].concat(problemHeaders).join(','));
  } else {
    lines.push(['排名', '用户名', '姓名', '状态', '总分'].concat(problemHeaders).join(','));
  }

  for (const student of students) {
    const score = scoreData.byUserId[student.id];
    if (!score) {
      const blanks = scoreData.problems.map(() => '');
      lines.push(['', csvCell(student.username), csvCell(student.realname), '未参赛', ''].concat(blanks).join(','));
      continue;
    }

    if (contest.type === 'acm') {
      lines.push([
        score.rank,
        csvCell(student.username),
        csvCell(student.realname),
        '已参赛',
        score.player.score || 0,
        syzoj.utils.formatTime(score.player.timeSum || 0)
      ].concat(score.problemResults.map(csvCell)).join(','));
    } else {
      lines.push([
        score.rank,
        csvCell(student.username),
        csvCell(student.realname),
        '已参赛',
        score.player.score || 0
      ].concat(score.problemResults.map(csvCell)).join(','));
    }
  }

  return `<pre>${escapeHtml(lines.join('\n'))}</pre>`;
}

async function buildTeacherReports(contest) {
  const scoreData = await buildContestScoreData(contest);
  const relations = await UserTeacher.find({
    order: {
      teacher_id: 'ASC',
      user_id: 'ASC'
    }
  });
  const teacherStudents = {};
  for (let relation of relations) {
    if (!teacherStudents[relation.teacher_id]) teacherStudents[relation.teacher_id] = [];
    teacherStudents[relation.teacher_id].push(relation.user_id);
  }

  const reports = [];
  for (let teacherId of Object.keys(teacherStudents)) {
    const teacher = await Teacher.findById(parseInt(teacherId));
    if (!teacher) continue;

    const students = [];
    for (let studentId of teacherStudents[teacherId]) {
      const student = await User.findById(studentId);
      if (student) students.push(student);
    }
    students.sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));

    if (!students.some(student => scoreData.byUserId[student.id])) continue;
    reports.push({
      teacher,
      students,
      body: buildTeacherReportBody(contest, teacher, students, scoreData)
    });
  }

  return reports;
}

async function runContestEmailTask(taskId) {
  const task = contestEmailTasks[taskId];
  if (!task) return;

  task.status = 'running';
  task.started_at = syzoj.utils.getCurrentDate();

  try {
    const contest = await Contest.findById(task.contest_id);
    if (!contest) throw new Error('无此比赛。');

    const reports = await buildTeacherReports(contest);
    task.total = reports.length;

    for (const report of reports) {
      const teacherName = report.teacher.name || `#${report.teacher.id}`;
      if (!report.teacher.email) {
        task.skipped++;
        task.logs.push({ teacher: teacherName, email: '', status: 'skipped', message: '教师邮箱为空。' });
        continue;
      }

      try {
        await Email.send(report.teacher.email, `[${syzoj.config.title}] 比赛成绩：${contest.title}`, report.body);
        task.success++;
        task.logs.push({ teacher: teacherName, email: report.teacher.email, status: 'success', message: '发送成功。' });
      } catch (e) {
        task.failed++;
        task.logs.push({ teacher: teacherName, email: report.teacher.email, status: 'failed', message: e.message });
      }
    }

    task.status = 'done';
  } catch (e) {
    task.status = 'failed';
    task.error = e.message;
    syzoj.log(e);
  } finally {
    task.finished_at = syzoj.utils.getCurrentDate();
  }
}

app.get('/contests', async (req, res) => {
  try {
    let query = Contest.createQueryBuilder();
    if (!res.locals.user || (!res.locals.user.is_admin && res.locals.user.user_type !== 'lecturer')) {
      query.where('Contest.is_public = 1');
    }

    if (!res.locals.user || (res.locals.user.user_type !== 'admin' && res.locals.user.user_type !== 'lecturer' && !res.locals.user.is_admin)) {
      query.andWhere(new (require('typeorm').Brackets)(qb => {
        qb.where(qb => {
          let subQuery = syzoj.model('contest-group').createQueryBuilder('cg')
            .select('cg.contest_id');
          return 'Contest.id NOT IN (' + subQuery.getQuery() + ')';
        })
        .orWhere(qb => {
          let subQuery = syzoj.model('contest-group').createQueryBuilder('cg')
            .innerJoin('user_group', 'ug', 'ug.group_id = cg.group_id')
            .select('cg.contest_id')
            .where('ug.user_id = :user_id', { user_id: res.locals.user ? res.locals.user.id : 0 });
          return 'Contest.id IN (' + subQuery.getQuery() + ')';
        });
      }), { user_id: res.locals.user ? res.locals.user.id : 0 });
    }

    query.orderBy('Contest.start_time', 'DESC');

    let paginate = syzoj.utils.paginate(await Contest.countForPagination(query), req.query.page, syzoj.config.page.contest);
    let contests = await Contest.queryPage(paginate, query);

    await contests.forEachAsync(async x => x.subtitle = await syzoj.utils.markdown(x.subtitle));

    res.render('contests', {
      contests: contests,
      paginate: paginate
    })
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/edit', async (req, res) => {
  try {

    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    let groups = []
    if (!contest) {
      // if contest does not exist, system administrators and lecturers can create one
      if (!res.locals.user || (!res.locals.user.is_admin && res.locals.user.user_type !== 'lecturer')) throw new ErrorMessage('您没有权限进行此操作。');

      contest = await Contest.create();
      contest.id = 0;
    } else {
      // if contest exists, both system administrators and contest administrators can edit it.
      if (!res.locals.user || (!res.locals.user.is_admin && res.locals.user.user_type !== 'admin' && res.locals.user.user_type !== 'lecturer' && !contest.admins.includes(res.locals.user.id.toString()))) throw new ErrorMessage('您没有权限进行此操作。');

      await contest.loadRelationships();
      groups = await contest.findGroupByContestId(contest.id);
    }

    let problems = [], admins = [];
    if (contest.problems) problems = await contest.problems.split('|').mapAsync(async id => await Problem.findById(id));
    if (contest.admins) admins = await contest.admins.split('|').mapAsync(async id => await User.findById(id));

    res.render('contest_edit', {
      contest: contest,
      problems: problems,
      admins: admins,
      existgroups: groups
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/contest/:id/edit', async (req, res) => {
  try {

    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    let ranklist = null;
    if (!contest) {
      // if contest does not exist, system administrators and lecturers can create one
      if (!res.locals.user || (!res.locals.user.is_admin && res.locals.user.user_type !== 'lecturer')) throw new ErrorMessage('您没有权限进行此操作。');

      contest = await Contest.create();

      contest.holder_id = res.locals.user.id;

      ranklist = await ContestRanklist.create();

      // Only new contest can be set type
      if (!['noi', 'ioi', 'acm'].includes(req.body.type)) throw new ErrorMessage('无效的赛制。');
      contest.type = req.body.type;
    } else {
      // if contest exists, both system administrators and contest administrators can edit it.
      if (!res.locals.user || (!res.locals.user.is_admin && res.locals.user.user_type !== 'admin' && res.locals.user.user_type !== 'lecturer' && !contest.admins.includes(res.locals.user.id.toString()))) throw new ErrorMessage('您没有权限进行此操作。');
      
      await contest.loadRelationships();
      ranklist = contest.ranklist;
    }

    try {
      ranklist.ranking_params = JSON.parse(req.body.ranking_params);
    } catch (e) {
      ranklist.ranking_params = {};
    }
    await ranklist.save();
    contest.ranklist_id = ranklist.id;

    if (!req.body.title.trim()) throw new ErrorMessage('比赛名不能为空。');
    contest.title = req.body.title;
    contest.subtitle = req.body.subtitle;
    if (!Array.isArray(req.body.problems)) req.body.problems = [req.body.problems];
    if (!Array.isArray(req.body.admins)) req.body.admins = [req.body.admins];
    contest.problems = req.body.problems.join('|');
    contest.admins = req.body.admins.join('|');
    contest.information = req.body.information;
    contest.start_time = syzoj.utils.parseDate(req.body.start_time);
    contest.end_time = syzoj.utils.parseDate(req.body.end_time);
    contest.is_public = req.body.is_public === 'on';
    contest.hide_statistics = req.body.hide_statistics === 'on';

    await contest.save();

    if (!req.body.groups) {
      req.body.groups = [];
    } else if (!Array.isArray(req.body.groups)) {
      req.body.groups = [req.body.groups];
    }
    
    let newGroups = await req.body.groups.map(x => parseInt(x));
    await contest.setGroups(newGroups);

    res.redirect(syzoj.utils.makeUrl(['contest', contest.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/export_all', async (req, res) => {
  try {
    if (!res.locals.user || (!res.locals.user.is_admin && res.locals.user.user_type !== 'admin' && res.locals.user.user_type !== 'lecturer')) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛。');

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.findById(id));

    let tmp = require('tmp-promise');
    let fs = require('fs-extra');
    let path = require('path');
    let p7zip = new (require('node-7z'));

    let dir = await tmp.dir({ unsafeCleanup: true });
    let rootDirName = (contest.title || `contest_${contest.id}`).replace(/[\\/:*?"<>|]/g, '_');
    let rootPath = path.join(dir.path, rootDirName);
    await fs.ensureDir(rootPath);

    for (let i = 0; i < problems.length; i++) {
      let problem = problems[i];
      if (!problem) continue;
      let problemTitle = (problem.title || `problem_${i + 1}`).replace(/[\\/:*?"<>|]/g, '_');
      let problemDirName = `${i + 1} - ${problemTitle}`;
      let problemPath = path.join(rootPath, problemDirName);
      await fs.ensureDir(problemPath);

      // Statement
      let statement = `# ${problem.title || ''}\n\n`;
      if (problem.description) statement += `## 题目描述\n\n${problem.description}\n\n`;
      if (problem.input_format) statement += `## 输入格式\n\n${problem.input_format}\n\n`;
      if (problem.output_format) statement += `## 输出格式\n\n${problem.output_format}\n\n`;
      if (problem.example) statement += `## 样例\n\n${problem.example}\n\n`;
      if (problem.limit_and_hint) statement += `## 数据范围与提示\n\n${problem.limit_and_hint}\n\n`;
      await fs.writeFile(path.join(problemPath, 'statement.md'), statement);

      // Testdata
      let testdataPath = problem.getTestdataPath();
      if (await fs.exists(testdataPath)) {
        await fs.copy(testdataPath, path.join(problemPath, 'testdata'));
      }
    }

    let zipFile = await tmp.file({ postfix: '.zip' });
    let sevenZipPath = syzoj.utils.resolvePath('bin', '7za');
    if (!await fs.exists(sevenZipPath)) {
      sevenZipPath = '7za'; // Fallback to PATH
    }

    try {
      const exec = require('child_process').exec;
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      const fs = require('fs-extra');
      if (await fs.exists(zipFile.path)) {
        await fs.remove(zipFile.path);
      }

      let cmd = `zip -r "${zipFile.path}" .`;
      syzoj.log(`Executing: ${cmd} in ${rootPath}`);
      await execAsync(cmd, { cwd: rootPath });
    } catch (err) {
      syzoj.log(`Zip failed: ${err.message}`);
      throw err;
    }

    res.download(zipFile.path, `${rootDirName}.zip`, async (err) => {
      await dir.cleanup();
      await zipFile.cleanup();
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e || new Error('Unknown error')
    });
  }
});

app.post('/contest/:id/publicize_problems', async (req, res) => {
  try {
    const contest_id = parseInt(req.params.id);
    const contest = await Contest.findById(contest_id);
    const curUser = res.locals.user;

    if (!contest) throw new ErrorMessage('无此比赛。');
    contest.admins = contest.admins || '';
    if (!await contest.isSupervisior(curUser)) throw new ErrorMessage('您没有权限进行此操作。');
    if (!contest.isEnded()) throw new ErrorMessage('比赛尚未结束，不能公开题目。');

    const problems_id = await contest.getProblems();
    for (const id of problems_id) {
      const problem = await Problem.findById(id);
      if (!problem || problem.is_public) continue;

      problem.is_public = true;
      problem.publicizer_id = curUser.id;
      problem.publicize_time = new Date();
      await problem.save();

      JudgeState.query('UPDATE `judge_state` SET `is_public` = 1 WHERE `problem_id` = ' + id);
    }

    res.redirect(syzoj.utils.makeUrl(['contest', contest.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id', async (req, res) => {
  try {
    const curUser = res.locals.user;
    let contest_id = parseInt(req.params.id);

    let contest = await Contest.findById(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛。');

    if (!await contest.isAllowedViewBy(res.locals.user, contest_id)) {
        throw new ErrorMessage('您没有权限访问此比赛。');
    }

    const isSupervisior = await contest.isSupervisior(curUser);

    // if contest is non-public, both system administrators and contest administrators can see it.
    if (!contest.is_public && (!res.locals.user || (!res.locals.user.is_admin && res.locals.user.user_type !== 'admin' && res.locals.user.user_type !== 'lecturer' && !contest.admins.split('|').includes(res.locals.user.id.toString())))) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');

    contest.running = contest.isRunning();
    contest.ended = contest.isEnded();
    contest.subtitle = await syzoj.utils.markdown(contest.subtitle);
    contest.information = await syzoj.utils.markdown(contest.information);

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.findById(id));

    let player = null;

    if (res.locals.user) {
      player = await ContestPlayer.findInContest({
        contest_id: contest.id,
        user_id: res.locals.user.id
      });
    }

    problems = problems.map(x => ({ problem: x, status: null, judge_id: null, statistics: null }));
    if (player) {
      for (let problem of problems) {
        if (contest.type === 'noi') {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.findById(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            if (!contest.ended && !await problem.problem.isAllowedEditBy(res.locals.user) && !['Compile Error', 'Waiting', 'Compiling'].includes(problem.status)) {
              problem.status = 'Submitted';
            }
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
          }
        } else if (contest.type === 'ioi') {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.findById(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
            await contest.loadRelationships();
            let multiplier = contest.ranklist.ranking_params[problem.problem.id] || 1.0;
            problem.feedback = (judge_state.score * multiplier).toString() + ' / ' + (100 * multiplier).toString();
          }
        } else if (contest.type === 'acm') {
          if (player.score_details[problem.problem.id]) {
            problem.status = {
              accepted: player.score_details[problem.problem.id].accepted,
              unacceptedCount: player.score_details[problem.problem.id].unacceptedCount
            };
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
          } else {
            problem.status = null;
          }
        }
      }
    }

    let hasStatistics = false;
    if ((!contest.hide_statistics) || (contest.ended) || (isSupervisior)) {
      hasStatistics = true;

      await contest.loadRelationships();
      let players = await contest.ranklist.getPlayers();
      for (let problem of problems) {
        problem.statistics = { attempt: 0, accepted: 0 };

        if (contest.type === 'ioi' || contest.type === 'noi') {
          problem.statistics.partially = 0;
        }

        for (let player of players) {
          if (player.score_details[problem.problem.id]) {
            problem.statistics.attempt++;
            if ((contest.type === 'acm' && player.score_details[problem.problem.id].accepted) || ((contest.type === 'noi' || contest.type === 'ioi') && player.score_details[problem.problem.id].score === 100)) {
              problem.statistics.accepted++;
            }

            if ((contest.type === 'noi' || contest.type === 'ioi') && player.score_details[problem.problem.id].score > 0) {
              problem.statistics.partially++;
            }
          }
        }
      }
    }

    res.render('contest', {
      contest: contest,
      problems: problems,
      hasStatistics: hasStatistics,
      isSupervisior: isSupervisior
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/ranklist', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    const curUser = res.locals.user;

    if (!contest) throw new ErrorMessage('无此比赛。');
    // if contest is non-public, both system administrators and contest administrators can see it.
    if (!contest.is_public && (!res.locals.user || (!res.locals.user.is_admin && res.locals.user.user_type !== 'admin' && res.locals.user.user_type !== 'lecturer' && !contest.admins.split('|').includes(res.locals.user.id.toString())))) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');

    if ([contest.allowedSeeingResult() && contest.allowedSeeingOthers(),
    contest.isEnded(),
    await contest.isSupervisior(curUser)].every(x => !x))
      throw new ErrorMessage('您没有权限进行此操作。');

    await contest.loadRelationships();

    let players_id = [];
    for (let i = 1; i <= contest.ranklist.ranklist.player_num; i++) players_id.push(contest.ranklist.ranklist[i]);

    let ranklist = await players_id.mapAsync(async player_id => {
      let player = await ContestPlayer.findById(player_id);

      if (contest.type === 'noi' || contest.type === 'ioi') {
        player.score = 0;
      }

      for (let i in player.score_details) {
        player.score_details[i].judge_state = await JudgeState.findById(player.score_details[i].judge_id);

        /*** XXX: Clumsy duplication, see ContestRanklist::updatePlayer() ***/
        if (contest.type === 'noi' || contest.type === 'ioi') {
          let multiplier = (contest.ranklist.ranking_params || {})[i] || 1.0;
          player.score_details[i].weighted_score = player.score_details[i].score == null ? null : Math.round(player.score_details[i].score * multiplier);
          player.score += player.score_details[i].weighted_score;
        }
      }

      let user = await User.findById(player.user_id);

      return {
        user: user,
        player: player
      };
    });

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.findById(id));

    // Students only ever see their own row, never anyone else's rank/score.
    const selfOnly = !!curUser && curUser.user_type === 'student' && !await contest.isSupervisior(curUser);

    res.render('contest_ranklist', {
      contest: contest,
      ranklist: ranklist,
      problems: problems,
      selfOnly: selfOnly,
      curUserId: curUser ? curUser.id : null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/contest/:id/email_report', async (req, res) => {
  try {
    const contest_id = parseInt(req.params.id);
    const contest = await Contest.findById(contest_id);
    const curUser = res.locals.user;

    if (!contest) throw new ErrorMessage('无此比赛。');
    contest.admins = contest.admins || '';
    if (!await contest.isSupervisior(curUser)) throw new ErrorMessage('您没有权限进行此操作。');
    if (!contest.isEnded()) throw new ErrorMessage('比赛尚未结束，不能发送成绩邮件。');
    if (!syzoj.config.email || syzoj.config.email.method !== 'smtp') throw new ErrorMessage('请先在后台邮件配置中启用 SMTP。');
    if (!syzoj.config.email.options || !syzoj.config.email.options.host || !syzoj.config.email.options.username || !syzoj.config.email.options.password) {
      throw new ErrorMessage('SMTP 配置不完整。');
    }

    const runningTask = getRunningEmailTask(contest.id);
    if (runningTask) {
      res.redirect(syzoj.utils.makeUrl(['contest', contest.id, 'email_report', runningTask.id]));
      return;
    }

    const taskId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    contestEmailTasks[taskId] = {
      id: taskId,
      contest_id: contest.id,
      contest_title: contest.title,
      status: 'pending',
      total: 0,
      success: 0,
      skipped: 0,
      failed: 0,
      logs: [],
      created_at: syzoj.utils.getCurrentDate(),
      created_by: curUser.id
    };

    setTimeout(() => runContestEmailTask(taskId), 0);
    res.redirect(syzoj.utils.makeUrl(['contest', contest.id, 'email_report', taskId]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/email_report/:taskId', async (req, res) => {
  try {
    const contest_id = parseInt(req.params.id);
    const contest = await Contest.findById(contest_id);
    const curUser = res.locals.user;
    const task = contestEmailTasks[req.params.taskId];

    if (!contest) throw new ErrorMessage('无此比赛。');
    contest.admins = contest.admins || '';
    if (!await contest.isSupervisior(curUser)) throw new ErrorMessage('您没有权限进行此操作。');
    if (!task || task.contest_id !== contest.id) throw new ErrorMessage('无此发送任务。');

    res.render('contest_email_report', {
      contest,
      task
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/email_report/:taskId/status', async (req, res) => {
  try {
    const contest_id = parseInt(req.params.id);
    const contest = await Contest.findById(contest_id);
    const curUser = res.locals.user;
    const task = contestEmailTasks[req.params.taskId];

    if (!contest) throw new ErrorMessage('无此比赛。');
    contest.admins = contest.admins || '';
    if (!await contest.isSupervisior(curUser)) throw new ErrorMessage('您没有权限进行此操作。');
    if (!task || task.contest_id !== contest.id) throw new ErrorMessage('无此发送任务。');

    res.json(task);
  } catch (e) {
    res.status(403).json({
      status: 'failed',
      error: e.message
    });
  }
});

function getDisplayConfig(contest) {
  return {
    showScore: contest.allowedSeeingScore(),
    showUsage: false,
    showCode: false,
    showResult: contest.allowedSeeingResult(),
    showOthers: contest.allowedSeeingOthers(),
    showDetailResult: contest.allowedSeeingTestcase(),
    showTestdata: false,
    inContest: true,
    showRejudge: false
  };
}

app.get('/contest/:id/submissions', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    // if contest is non-public, both system administrators and contest administrators can see it.
    if (!contest.is_public && (!res.locals.user || (!res.locals.user.is_admin && res.locals.user.user_type !== 'admin' && res.locals.user.user_type !== 'lecturer' && !contest.admins.split('|').includes(res.locals.user.id.toString())))) throw new ErrorMessage('比赛未公开，请耐心等待 (´∀ `)');

    if (contest.isEnded()) {
      res.redirect(syzoj.utils.makeUrl(['submissions'], { contest: contest_id }));
      return;
    }

    const displayConfig = getDisplayConfig(contest);
    let problems_id = await contest.getProblems();
    const curUser = res.locals.user;

    let user = req.query.submitter && await User.fromName(req.query.submitter);

    let query = JudgeState.createQueryBuilder();

    let isFiltered = false;
    // Students never get to see other students' submissions, even in contest
    // types (e.g. ACM) that otherwise show everyone's submissions.
    if (displayConfig.showOthers && !(curUser && curUser.user_type === 'student')) {
      if (user) {
        query.andWhere('user_id = :user_id', { user_id: user.id });
        isFiltered = true;
      }
    } else {
      if (curUser == null || // Not logined
        (user && user.id !== curUser.id)) { // Not querying himself
        throw new ErrorMessage("您没有权限执行此操作。");
      }
      query.andWhere('user_id = :user_id', { user_id: curUser.id });
      isFiltered = true;
    }

    if (displayConfig.showScore) {
      let minScore = parseInt(req.body.min_score);
      if (!isNaN(minScore)) query.andWhere('score >= :minScore', { minScore });
      let maxScore = parseInt(req.body.max_score);
      if (!isNaN(maxScore)) query.andWhere('score <= :maxScore', { maxScore });

      if (!isNaN(minScore) || !isNaN(maxScore)) isFiltered = true;
    }

    if (req.query.language) {
      if (req.body.language === 'submit-answer') {
        query.andWhere(new TypeORM.Brackets(qb => {
          qb.orWhere('language = :language', { language: '' })
            .orWhere('language IS NULL');
        }));
      } else if (req.body.language === 'non-submit-answer') {
        query.andWhere('language != :language', { language: '' })
             .andWhere('language IS NOT NULL');
      } else {
        query.andWhere('language = :language', { language: req.body.language })
      }
      isFiltered = true;
    }

    if (displayConfig.showResult) {
      if (req.query.status) {
        query.andWhere('status = :status', { status: req.query.status });
        isFiltered = true;
      }
    }

    if (req.query.problem_id) {
      problem_id = problems_id[parseInt(req.query.problem_id) - 1] || 0;
      query.andWhere('problem_id = :problem_id', { problem_id })
      isFiltered = true;
    }

    query.andWhere('type = 1')
         .andWhere('type_info = :contest_id', { contest_id });

    let judge_state, paginate;

    if (syzoj.config.submissions_page_fast_pagination) {
      const queryResult = await JudgeState.queryPageFast(query, syzoj.utils.paginateFast(
        req.query.currPageTop, req.query.currPageBottom, syzoj.config.page.judge_state
      ), -1, parseInt(req.query.page));

      judge_state = queryResult.data;
      paginate = queryResult.meta;
    } else {
      paginate = syzoj.utils.paginate(
        await JudgeState.countQuery(query),
        req.query.page,
        syzoj.config.page.judge_state
      );
      judge_state = await JudgeState.queryPage(paginate, query, { id: "DESC" }, true);
    }

    await judge_state.forEachAsync(async obj => {
      await obj.loadRelationships();
      obj.problem_id = problems_id.indexOf(obj.problem_id) + 1;
      obj.problem.title = syzoj.utils.removeTitleTag(obj.problem.title);
    });

    const pushType = displayConfig.showResult ? 'rough' : 'compile';
    res.render('submissions', {
      vjudge: require("../libs/vjudge"),
      contest: contest,
      items: judge_state.map(x => ({
        info: getSubmissionInfo(x, displayConfig),
        token: (getRoughResult(x, displayConfig) == null && x.task_id != null) ? jwt.sign({
          taskId: x.task_id,
          type: pushType,
          displayConfig: displayConfig
        }, syzoj.config.session_secret) : null,
        result: getRoughResult(x, displayConfig),
        running: false,
      })),
      paginate: paginate,
      form: req.query,
      displayConfig: displayConfig,
      pushType: pushType,
      isFiltered: isFiltered,
      fast_pagination: syzoj.config.submissions_page_fast_pagination
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});


app.get('/contest/submission/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const judge = await JudgeState.findById(id);
    if (!judge) throw new ErrorMessage("提交记录 ID 不正确。");
    const curUser = res.locals.user;
    if ((!curUser) || judge.user_id !== curUser.id) throw new ErrorMessage("您没有权限执行此操作。");

    if (judge.type !== 1) {
      return res.redirect(syzoj.utils.makeUrl(['submission', id]));
    }

    const contest = await Contest.findById(judge.type_info);
    contest.ended = contest.isEnded();

    const displayConfig = getDisplayConfig(contest);
    displayConfig.showCode = true;

    await judge.loadRelationships();
    const problems_id = await contest.getProblems();
    judge.problem_id = problems_id.indexOf(judge.problem_id) + 1;
    judge.problem.title = syzoj.utils.removeTitleTag(judge.problem.title);

    if (judge.problem.type !== 'submit-answer') {
      judge.codeLength = Buffer.from(judge.code).length;
      judge.code = await syzoj.utils.highlight(judge.code, (judge.problem.getVJudgeLanguages() || syzoj.languages)[judge.language].highlight);
    }

    res.render('submission', {
      info: getSubmissionInfo(judge, displayConfig),
      roughResult: getRoughResult(judge, displayConfig),
      code: (displayConfig.showCode && judge.problem.type !== 'submit-answer') ? judge.code.toString("utf8") : '',
      formattedCode: judge.formattedCode ? judge.formattedCode.toString("utf8") : null,
      preferFormattedCode: res.locals.user ? res.locals.user.prefer_formatted_code : false,
      detailResult: processOverallResult(judge.result, displayConfig),
      socketToken: (displayConfig.showDetailResult && judge.pending && judge.task_id != null) ? jwt.sign({
        taskId: judge.task_id,
        displayConfig: displayConfig,
        type: 'detail'
      }, syzoj.config.session_secret) : null,
      displayConfig: displayConfig,
      contest: contest,
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/problem/:pid', async (req, res) => {
  try {
    let contest_id = parseInt(req.params.id);
    let contest = await Contest.findById(contest_id);
    if (!contest) throw new ErrorMessage('无此比赛。');
    const curUser = res.locals.user;

    let problems_id = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.findById(problem_id);
    await problem.loadRelationships();

    contest.ended = contest.isEnded();
    if (!await contest.isSupervisior(curUser) && !(contest.isRunning() || contest.isEnded())) {
      if (await problem.isAllowedUseBy(res.locals.user)) {
        return res.redirect(syzoj.utils.makeUrl(['problem', problem_id]));
      }
      throw new ErrorMessage('比赛尚未开始。');
    }

    problem.specialJudge = await problem.hasSpecialJudge();

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let state = await problem.getJudgeState(res.locals.user, false);
    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    await problem.loadRelationships();

    res.render('problem', {
      pid: pid,
      contest: contest,
      problem: problem,
      state: state,
      lastLanguage: res.locals.user ? await res.locals.user.getLastSubmitLanguage() : null,
      testcases: testcases,
      languages: problem.getVJudgeLanguages()
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/contest/:id/:pid/download/additional_file', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let contest = await Contest.findById(id);
    if (!contest) throw new ErrorMessage('无此比赛。');

    let problems_id = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.findById(problem_id);

    contest.ended = contest.isEnded();
    if (!(contest.isRunning() || contest.isEnded())) {
      if (await problem.isAllowedUseBy(res.locals.user)) {
        return res.redirect(syzoj.utils.makeUrl(['problem', problem_id, 'download', 'additional_file']));
      }
      throw new ErrorMessage('比赛尚未开始。');
    }

    await problem.loadRelationships();

    if (!problem.additional_file) throw new ErrorMessage('无附加文件。');

    res.download(problem.additional_file.getPath(), `additional_file_${id}_${pid}.zip`);
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});
