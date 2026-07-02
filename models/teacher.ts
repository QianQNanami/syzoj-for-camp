import * as TypeORM from "typeorm";
import Model from "./common";

import UserTeacher from "./user-teacher";

@TypeORM.Entity()
export default class Teacher extends Model {
  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  name: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  email: string;

  // 删除教师时清理其在 user_teacher 中的关系行
  static async deleteById(tid) {
    let rels = await UserTeacher.find({ where: { teacher_id: tid } });
    for (let r of rels) {
      let obj = await UserTeacher.findOne({ where: { teacher_id: tid, user_id: r.user_id } });
      if (obj) await obj.destroy();
    }
  }
}
