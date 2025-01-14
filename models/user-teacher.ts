import * as TypeORM from "typeorm";
import Model from "./common";

@TypeORM.Entity()
export default class UserTeacher extends Model {
    @TypeORM.Index()
    @TypeORM.PrimaryColumn({ type: "integer" })
    user_id: number;

    @TypeORM.Index()
    @TypeORM.PrimaryColumn({ type: "integer" })
    teacher_id: number;
}