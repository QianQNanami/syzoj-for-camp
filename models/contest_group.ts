import * as TypeORM from "typeorm";
import Model from "./common";

export default class ContestGroup extends Model {
    @TypeORM.Index()
    @TypeORM.PrimaryColumn({ type: "integer" })
    contest_id: number;
    @TypeORM.PrimaryColumn({ type: "integer" })
    group_id: number;
}