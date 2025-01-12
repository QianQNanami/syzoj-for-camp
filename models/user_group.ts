import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

@TypeORM.Entity()
export default class UserGroup extends Model {
  @TypeORM.Index()
  @TypeORM.PrimaryColumn({ type: "integer" })
  user_id: number;
  
  @TypeORM.PrimaryColumn({ type: "varchar", length: 80 })
  group: string;
}