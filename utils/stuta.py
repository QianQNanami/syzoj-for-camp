import random
import string
from hashlib import md5
import time

f = open('./utils/stu.sql', 'w', encoding='utf-8')
namelist = open('./utils/student.csv', 'r', encoding='utf-8')

i = 135

for cnt in range(581):
    i += 1
    name, school, tea, group, username, random_str, loc = namelist.readline().strip().split(',')
    name = name.strip()
    username = username.strip()
    random_str = random_str.strip()
    # pw.write(f"{name}, {username}, {random_str}\n")
    random_str = md5((random_str + 'syzoj2_xxx').encode()).hexdigest()
    f.write(f"INSERT INTO user \
            (id, username, email, password, is_show, public_email, prefer_formatted_code, sex, rating, register_time, user_type, school, realname, location) \
            VALUES \
            ({i}, '{username}', '{username}@jsoi.cn', '{random_str}', 1, 1, 1, 0, 1500, '{int(time.time())}', 'student', '{school}', '{name}', '{loc}');\n")
    # f.write(f"INSERT INTO user_privilege (user_id, privilege) VALUES ({i}, 'manage_problem');\n")
    # f.write(f"INSERT INTO user_privilege (user_id, privilege) VALUES ({i}, 'manage_problem_tag');\n")
    # f.write(f"INSERT INTO user_privilege (user_id, privilege) VALUES ({i}, 'manage_user');\n")
    f.write(f"INSERT INTO user_group (user_id, group_id) VALUES ({i}, {group});\n")
    group = 6
    f.write(f"INSERT INTO user_group (user_id, group_id) VALUES ({i}, {group});\n")
    f.write(f"INSERT INTO user_teacher (user_id, teacher_id) VALUES ({i}, {tea});\n")