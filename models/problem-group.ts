import * as TypeORM from "typeorm";
import Model from "./common";

@TypeORM.Entity()
export default class ProblemGroup extends Model {
    @TypeORM.Index()
    @TypeORM.PrimaryColumn({ type: "integer" })
    problem_id: number;
    @TypeORM.PrimaryColumn({ type: "integer" })
    group_id: number;
}