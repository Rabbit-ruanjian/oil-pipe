package com.pipeline.data.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.pipeline.common.core.domain.Result;
import com.pipeline.data.domain.Pipeline;
import com.pipeline.data.service.IPipelineService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 管道参数管理控制器
 */
@RestController
@RequestMapping("/pipeline")
public class PipelineController {

    @Autowired
    private IPipelineService pipelineService;

    /**
     * 根据项目ID查询管道列表
     */
    @GetMapping("/list/{proId}")
    public Result<List<Pipeline>> list(@PathVariable("proId") Long proId) {
        return Result.ok(pipelineService.list(new LambdaQueryWrapper<Pipeline>().eq(Pipeline::getProId, proId)));
    }

    /**
     * 获取管道详细信息
     */
    @GetMapping(value = "/{id}")
    public Result<Pipeline> getInfo(@PathVariable("id") Long id) {
        return Result.ok(pipelineService.getById(id));
    }

    /**
     * 新增管道
     */
    @PostMapping
    public Result<Boolean> add(@RequestBody Pipeline pipeline) {
        return Result.ok(pipelineService.save(pipeline));
    }

    /**
     * 修改管道
     */
    @PutMapping
    public Result<Boolean> edit(@RequestBody Pipeline pipeline) {
        return Result.ok(pipelineService.updateById(pipeline));
    }

    /**
     * 删除管道
     */
    @DeleteMapping("/{ids}")
    public Result<Boolean> remove(@PathVariable List<Long> ids) {
        return Result.ok(pipelineService.removePipelinesCascade(ids));
    }
}
