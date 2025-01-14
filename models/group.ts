import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

@TypeORM.Entity()
export default class Group extends Model {
  @TypeORM.Index({ unique: true })
  @TypeORM.PrimaryColumn({ type: "integer" })
  group_id: number;
  
  @TypeORM.PrimaryColumn({ type: "varchar", length: 80})
  group_name: string;
}