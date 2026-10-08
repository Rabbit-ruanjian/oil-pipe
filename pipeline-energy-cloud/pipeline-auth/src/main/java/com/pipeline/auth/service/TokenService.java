package com.pipeline.auth.service;

import cn.dev33.satoken.stp.SaTokenInfo;
import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.crypto.digest.BCrypt;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.pipeline.auth.domain.LoginBody;
import com.pipeline.auth.domain.SysUser;
import com.pipeline.auth.mapper.SysUserMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

/**
 * Token管理服务
 */
@Service
public class TokenService {

    @Autowired
    private SysUserMapper userMapper;

    /**
     * 登录验证
     *
     * @param loginBody 登录信息
     * @return 结果
     */
    public Map<String, Object> login(LoginBody loginBody) {
        String username = loginBody.getUsername();
        String password = loginBody.getPassword();

        // 1. 查询用户
        SysUser user = userMapper.selectOne(new QueryWrapper<SysUser>().eq("user_name", username));

        if (user == null) {
            throw new RuntimeException("用户不存在");
        }

        if ("1".equals(user.getDelFlag())) {
            throw new RuntimeException("用户已删除");
        }

        if ("1".equals(user.getStatus())) {
            throw new RuntimeException("用户已停用");
        }

        // 2. 校验密码 (使用 BCrypt)
        // 注意：虽然使用了 Sa-Token，但密码加密通常还是用 BCrypt
        if (!BCrypt.checkpw(password, user.getPassword())) {
            throw new RuntimeException("密码错误");
        }

        // 3. Sa-Token 登录
        StpUtil.login(user.getUserId());

        // 4. 获取 Token 信息
        SaTokenInfo tokenInfo = StpUtil.getTokenInfo();

        Map<String, Object> tokenMap = new HashMap<>();
        tokenMap.put("access_token", tokenInfo.tokenValue);
        tokenMap.put("token", tokenInfo.tokenValue);
        tokenMap.put("expires_in", tokenInfo.tokenTimeout);
        tokenMap.put("userId", user.getUserId());
        tokenMap.put("username", user.getUserName());
        tokenMap.put("nickname", user.getNickName());
        return tokenMap;
    }
}
