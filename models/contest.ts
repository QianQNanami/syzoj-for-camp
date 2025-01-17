import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj, ErrorMessage: any;

import User from "./user";
import Problem from "./problem";
import ContestRanklist from "./contest_ranklist";
import ContestPlayer from "./contest_player";
import ContestGroup from "./contest-group";
import UserGroup from "./user-group";
import Group from "./group";

enum ContestType {
  NOI = "noi",
  IOI = "ioi",
  ICPC = "acm"
}

@TypeORM.Entity()
export default class Contest extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  subtitle: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  start_time: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  end_time: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  holder_id: number;

  // type: noi, ioi, acm
  @TypeORM.Column({ nullable: true, type: "enum", enum: ContestType })
  type: ContestType;

  @TypeORM.Column({ nullable: true, type: "text" })
  information: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  problems: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  admins: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  ranklist_id: number;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  hide_statistics: boolean;

  holder?: User;
  ranklist?: ContestRanklist;

  async loadRelationships() {
    this.holder = await User.findById(this.holder_id);
    this.ranklist = await ContestRanklist.findById(this.ranklist_id);
  }

  async isSupervisior(user) {
    return user && (user.is_admin || this.holder_id === user.id || this.admins.split('|').includes(user.id.toString()));
  }

  allowedSeeingOthers() {
    if (this.type === 'acm') return true;
    else return false;
  }

  allowedSeeingScore() { // If not, then the user can only see status
    if (this.type === 'ioi') return true;
    else return false;
  }

  allowedSeeingResult() { // If not, then the user can only see compile progress
    if (this.type === 'ioi' || this.type === 'acm') return true;
    else return false;
  }

  allowedSeeingTestcase() {
    if (this.type === 'ioi') return true;
    return false;
  }

  async getProblems() {
    if (!this.problems) return [];
    return this.problems.split('|').map(x => parseInt(x));
  }

  async setProblemsNoCheck(problemIDs) {
    this.problems = problemIDs.join('|');
  }

  async setProblems(s) {
    let a = [];
    await s.split('|').forEachAsync(async x => {
      let problem = await Problem.findById(x);
      if (!problem) return;
      a.push(x);
    });
    this.problems = a.join('|');
  }

  async newSubmission(judge_state) {
    if (!(judge_state.submit_time >= this.start_time && judge_state.submit_time <= this.end_time)) {
      return;
    }
    let problems = await this.getProblems();
    if (!problems.includes(judge_state.problem_id)) throw new ErrorMessage('当前比赛中无此题目。');

    await syzoj.utils.lock(['Contest::newSubmission', judge_state.user_id], async () => {
      let player = await ContestPlayer.findInContest({
        contest_id: this.id,
        user_id: judge_state.user_id
      });

      if (!player) {
        player = await ContestPlayer.create({
          contest_id: this.id,
          user_id: judge_state.user_id
        });
        await player.save();
      }

      await player.updateScore(judge_state);
      await player.save();

      await this.loadRelationships();
      await this.ranklist.updatePlayer(this, player);
      await this.ranklist.save();
    });
  }

  isRunning(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return now >= this.start_time && now < this.end_time;
  }

  isEnded(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return now >= this.end_time;
  }

  async isAllowedViewBy(user, cid) {
    if(!user) return false;
    // if (user.is_admin) return true;
    // if (user.type == "admin" || user.type == "lecturer") return true;
    let allowedGroup = await ContestGroup.find({
        where: {
            contest_id: cid,
        }
    });
    for (let group of allowedGroup) {
        let hasgroup = await UserGroup.find({
            where: {
                user_id: user.id,
                group_id: group.group_id,
            }
        });
        if(hasgroup) return true;
    }
    return false;
  }

  async findGroupByContestId(cid) {
    let groups = await ContestGroup.find({
      where: {
        contest_id: cid,
      }
    });
  
    let groupIds = groups.map(group => group.group_id);
  
    if (groupIds.length === 0) {
      return [];
    }
  
    let groupInstances = await Group.createQueryBuilder('group')
    .where('group.group_id IN (:...ids)', { ids: groupIds })
    .getMany();
  
    return groupInstances;
  }
  
  async setGroups(newGroupIDs) {
      let oldGroupIDs = (await ContestGroup.find({where:{contest_id: this.id}})).map(x => x.group_id);
  
      let delGroupIDs = oldGroupIDs.filter(x => !newGroupIDs.includes(x));
      let addGroupIDs = newGroupIDs.filter(x => !oldGroupIDs.includes(x));
  
      for (let gid of delGroupIDs) {
        let map = await ContestGroup.findOne({
          where: {
            contest_id: this.id,
            group_id: gid
          }
        });
  
        await map.destroy();
      }
  
      for (let gid of addGroupIDs) {
        let map = await ContestGroup.create({
          contest_id: this.id,
          group_id: gid
        });
  
        await map.save();
      }
  
    }

}
