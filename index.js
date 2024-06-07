const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { init: initDB, Counter } = require("./db");
const axios = require('axios');
const crypto = require('crypto');
const logger = morgan("tiny");
const NodeCache = require( "node-cache" );

const appId = 'wxeb4ce15752cf1d30';
const appSecret = '8de5c379ac62cf9a5f25c607f7be6cc0';
// 填写你在微信公众平台上设置的 Token
const TOKEN = 'wincax';

// 使用 NodeCache 来缓存 access_token
const cache = new NodeCache({ checkperiod: 60 });

// 获取 access_token 的函数
const getAccessToken = async () => {
  const token = cache.get('access_token');
  if (token) {
    return token;
  }

  const response = await axios.get(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`);
  const { access_token, expires_in } = response.data;

  // 将 access_token 缓存，并设置为提前 300 秒刷新
  cache.set('access_token', access_token, expires_in - 300);
  return access_token;
};

// 定时刷新 access_token
const refreshToken = async () => {
  try {
    await getAccessToken();
  } catch (error) {
    console.error('Error refreshing access_token:', error);
  }
};

// 每 1 小时刷新一次
setInterval(refreshToken, 3600000);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// 首页
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 更新计数
app.post("/api/count", async (req, res) => {
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({
      truncate: true,
    });
  }
  res.send({
    code: 0,
    data: await Counter.count(),
  });
});

// 获取计数
app.get("/api/count", async (req, res) => {
  const result = await Counter.count();
  res.send({
    code: 0,
    data: result,
  });
});

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});

// Endpoint to initiate WeChat OAuth
app.get('/auth/wechat', (req, res) => {
  const { code } = req.query;
  // const winxinAppId = 'wxeb4ce15752cf1d30'; // 'wxe78a01a0ffd9a5b8';
  // const winxinAppSecret = '8de5c379ac62cf9a5f25c607f7be6cc0'; // 'f83ef6e48cc8f7688e4d713e59667712';
  // const appId = 'wxeb4ce15752cf1d30';
  // const appSecret = '8de5c379ac62cf9a5f25c607f7be6cc0';

  // Exchange code for access token
  axios.get(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`)
    .then(response => {
      const { access_token, openid } = response.data;
      // Here you have the openid, you can do further processing
      res.send({
        code: 0,
        data: {openid},
      });
    })
    .catch(error => {
      console.error('Error exchanging code for access token:', error.response.data);
      res.status(500).send('Error occurred');
    });
});

// 提供接口供其他业务服务器获取当前有效的 access_token
app.get('/getAccessToken', async (req, res) => {
  try {
    const token = await getAccessToken();
    res.send({
      code: 0,
      token: {access_token: token},
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get access_token' });
  }
});

// 被动刷新 access_token 的接口
app.get('/refreshAccessToken', async (req, res) => {
  try {
    const token = await getAccessToken();
    res.send({
      code: 0,
      token: {access_token: token},
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh access_token' });
  }
});

// 验证微信服务器地址的有效性
app.get('/wechat', (req, res) => {
  const { signature, timestamp, nonce, echostr } = req.query;

  // 1. 将 token、timestamp、nonce 三个参数进行字典序排序
  const array = [TOKEN, timestamp, nonce].sort();
  const tempStr = array.join('');

  // 2. 将三个参数字符串拼接成一个字符串进行 sha1 加密
  const hashCode = crypto.createHash('sha1'); // 创建加密类型
  const resultCode = hashCode.update(tempStr, 'utf8').digest('hex'); // 对传入的字符串进行加密

  // 3. 开发者获得加密后的字符串可与 signature 对比，标识该请求来源于微信
  if (resultCode === signature) {
    res.send(echostr);
  } else {
    res.send('Invalid signature');
  }
});

const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
