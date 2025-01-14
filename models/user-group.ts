import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

@TypeORM.Entity()
export default class UserGroup extends Model {
  @TypeORM.Index()
  @TypeORM.PrimaryColumn({ type: "integer" })
  user_id_fucorm: number;
  
  @TypeORM.PrimaryColumn({ type: "integer"})
  group_id: number;
}