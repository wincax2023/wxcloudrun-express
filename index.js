const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { init: initDB, Counter } = require("./db");

const logger = morgan("tiny");

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
  const appId = 'wxeb4ce15752cf1d30';
  const appSecret = '8de5c379ac62cf9a5f25c607f7be6cc0';

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


const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
