import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

import JudgeState from "./judge_state";
import UserPrivilege from "./user_privilege";
import Article from "./article";
import UserTeacher from "./user-teacher";
import UserGroup from "./user-group";

export enum UserType {
    Student = "student",
    Teacher = "teacher",
    Lecturer = "lecturer",
    Admin = "admin"
}

@TypeORM.Entity()
export default class User extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Index({ unique: true })
  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  username: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  email: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  password: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  nickname: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  nameplate: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  information: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  ac_num: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  submit_num: number;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_admin: boolean;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_show: boolean;

  @TypeORM.Column({ nullable: true, type: "boolean", default: true })
  public_email: boolean;

  @TypeORM.Column({ nullable: true, type: "boolean", default: true })
  prefer_formatted_code: boolean;

  @TypeORM.Column({ nullable: true, type: "integer" })
  sex: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  rating: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  register_time: number;

  @TypeORM.Column({ nullable: true, type: "enum",
    enum: UserType, default: UserType.Student
  })
  user_type: UserType;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  school: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 60 })
  realname: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  location: string;

  static async fromEmail(email): Promise<User> {
    return User.findOne({
      where: {
        email: String(email)
      }
    });
  }

  static async fromName(name): Promise<User> {
    return User.findOne({
      where: {
        username: String(name)
      }
    });
  }

  static async fromRealName(name): Promise<User> {
    return User.findOne({
      where: {
        realname: String(name)
      }
    });
  }

  async isAllowedEditBy(user) {
    if (!user) return false;
    if (await user.hasPrivilege('manage_user')) return true;
    return user && (user.is_admin || this.id === user.id);
  }

  getQueryBuilderForACProblems() {
    return JudgeState.createQueryBuilder()
                     .select(`DISTINCT(problem_id)`)
                     .where('user_id = :user_id', { user_id: this.id })
                     .andWhere('status = :status', { status: 'Accepted' })
                     .andWhere('type != 1')
                     .orderBy({ problem_id: 'ASC' })
  }

  async refreshSubmitInfo() {
    await syzoj.utils.lock(['User::refreshSubmitInfo', this.id], async () => {
      this.ac_num = await JudgeState.countQuery(this.getQueryBuilderForACProblems());
      this.submit_num = await JudgeState.count({
        user_id: this.id,
        type: TypeORM.Not(1) // Not a contest submission
      });

      await this.save();
    });
  }

  async getACProblems() {
    let queryResult = await this.getQueryBuilderForACProblems().getRawMany();

    return queryResult.map(record => record['problem_id'])
  }

  async getArticles() {
    return await Article.find({
      where: {
        user_id: this.id
      }
    });
  }

  async getStatistics() {
    let statuses = {
      "Accepted": ["Accepted"],
      "Wrong Answer": ["Wrong Answer", "File Error", "Output Limit Exceeded"],
      "Runtime Error": ["Runtime Error"],
      "Time Limit Exceeded": ["Time Limit Exceeded"],
      "Memory Limit Exceeded": ["Memory Limit Exceeded"],
      "Compile Error": ["Compile Error"]
    };

    let res = {};
    for (let status in statuses) {
      res[status] = 0;
      for (let s of statuses[status]) {
        res[status] += await JudgeState.count({
          user_id: this.id,
          type: 0,
          status: s
        });
      }
    }

    return res;
  }

  async renderInformation() {
    this.information = await syzoj.utils.markdown(this.information);
  }

  async getPrivileges() {
    let privileges = await UserPrivilege.find({
      where: {
        user_id: this.id
      }
    });

    return privileges.map(x => x.privilege);
  }

  async setPrivileges(newPrivileges) {
    let oldPrivileges = await this.getPrivileges();

    let delPrivileges = oldPrivileges.filter(x => !newPrivileges.includes(x));
    let addPrivileges = newPrivileges.filter(x => !oldPrivileges.includes(x));

    for (let privilege of delPrivileges) {
      let obj = await UserPrivilege.findOne({ where: {
        user_id: this.id,
        privilege: privilege
      } });

      await obj.destroy();
    }

    for (let privilege of addPrivileges) {
      let obj = await UserPrivilege.create({
        user_id: this.id,
        privilege: privilege
      });

      await obj.save();
    }
  }

  async hasPrivilege(privilege) {
    if (this.is_admin) return true;

    let x = await UserPrivilege.findOne({ where: { user_id: this.id, privilege: privilege } });
    return !!x;
  }

  async isStudent() {
    if (this.user_type == UserType.Student) return true;
    return false;
  }

  async isTeacher() {
    if (this.user_type == UserType.Student) return true;
    return false;
  }

  async getLastSubmitLanguage() {
    let a = await JudgeState.findOne({
      where: {
        user_id: this.id
      },
      order: {
        submit_time: 'DESC'
      }
    });
    if (a) return a.language;

    return null;
  }

  async getTeacher() {
    if (this.user_type == "student") {
      let teacher = await UserTeacher.find({
        where: {
          user_id: this.id
        },
        order: {
          teacher_id: 'ASC'
        }
      });
      return teacher;
    }
    else return null;
  }

  async getStudents() {
    if (this.user_type == "teacher") {
      let students = await UserTeacher.find({
        where: {
          teacher_id: this.id
        },
        order: {
          user_id: 'ASC'
        }
      });
      return students;
    }
    else return null;
  }

  async setTeacher(newTeacher) {
    if (this.user_type == "student") {
      let oldTeacher = await this.getTeacher();

      let delTeacher = oldTeacher.filter(x => !newTeacher.includes(x));
      let addTeacher = newTeacher.filter(x => !oldTeacher.includes(x));

      for (let teacher of delTeacher) {
        let obj = await UserTeacher.findOne({ where: {
          user_id: this.id,
          teacher_id: teacher
        } });

        await obj.destroy();
      }

      for (let teacher of addTeacher) {
        let obj = await UserTeacher.create({
          user_id: this.id,
          teacher_id: teacher
        });

        await obj.save();
      }
    }
  }

  async getGroup() {
    let group = await UserGroup.find({
      where: {
        user_id: this.id
      },
      order: {
        group_id: 'ASC'
      }
    });
    return group;
  }

  async setGroup(newGroup) {
    let oldGroup = await this.getGroup();

    let delGroup = oldGroup.filter(x => !newGroup.includes(x));
    let addGroup = newGroup.filter(x => !oldGroup.includes(x));

    for (let group of delGroup) {
      let obj = await UserGroup.findOne({ where: {
        user_id: this.id,
        group_id: group
      } });

      await obj.destroy();
    }

    for (let group of addGroup) {
      let obj = await UserGroup.create({
        user_id: this.id,
        group_id: group
      });

      await obj.save();
    }
  }

}
