import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;
import ContestGroup from "./contest-group";
import UserGroup from "./user-group";
import ProblemGroup from "./problem-group";

@TypeORM.Entity()
export default class Group extends Model {
  @TypeORM.Index({ unique: true })
  @TypeORM.PrimaryColumn({ type: "integer" })
  group_id: number;
  
  @TypeORM.PrimaryColumn({ type: "varchar", length: 80})
  group_name: string;

  async deleteById(gid) {
    let contest = await ContestGroup.find({
        where: {
            group_id: gid
        }
    })
    let user = await UserGroup.find({
        where: {
            group_id: gid
        }
    })
    let problem = await ProblemGroup.find({
        where: {
            group_id: gid
        }
    })
    for (let c of contest) {
        let obj = await ContestGroup.findOne({
            where: {
                group_id: gid,
                contest_id: c.contest_id
            }
        })
        await obj.destroy();
    }
    for (let u of user) {
        let obj = await UserGroup.findOne({
            where: {
                group_id: gid,
                user_id: u.user_id
            }
        })
        await obj.destroy();
    }
    for (let p of problem) {
        let obj = await ProblemGroup.findOne({
            where: {
                group_id: gid,
                problem_id: p.problem_id
            }
        })
        await obj.destroy();
    }
  } 
}