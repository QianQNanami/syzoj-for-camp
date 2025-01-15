import random
import string
from hashlib import md5
import time

f = open('stuta.sql', 'w', encoding='utf-8')
pw = open('stuta.csv', 'w', encoding='utf-8')
for i in range(2, 16):
    random_str = ''.join(random.choices(string.ascii_letters + string.digits, k=12))
    username, name, group = input().split()
    pw.write(f"{name}, {username}, {random_str}\n")
    random_str = md5((random_str + 'syzoj2_xxx').encode()).hexdigest()
    f.write(f"INSERT INTO user \
            (id, username, email, password, is_show, public_email, prefer_formatted_code, sex, rating, register_time, user_type, school, realname) \
            VALUES \
            ({i}, '{username}', '{username}@jsoi.cn', '{random_str}', 1, 1, 1, 0, 1500, '{int(time.time())}', 'admin', 'JSOI TECH TEAM', '{name}');\n")
    f.write(f"INSERT INTO user_privilege (user_id, privilege) VALUES ({i}, 'manage_problem');\n")
    f.write(f"INSERT INTO user_privilege (user_id, privilege) VALUES ({i}, 'manage_problem_tag');\n")
    f.write(f"INSERT INTO user_privilege (user_id, privilege) VALUES ({i}, 'manage_user');\n")
    f.write(f"INSERT INTO user_group (user_id, group_id) VALUES ({i}, {group});\n")