import { migrate, db } from '../server/db.js';
migrate();
console.log('数据库迁移完成：', db.name);
db.close();
