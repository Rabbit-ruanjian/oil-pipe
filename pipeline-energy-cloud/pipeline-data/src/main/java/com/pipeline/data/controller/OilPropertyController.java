package com.pipeline.data.controller;

import com.pipeline.common.core.domain.Result;
import com.pipeline.data.domain.OilProperty;
import com.pipeline.data.service.IOilPropertyService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 油品特性管理控制器
 */
@RestController
@RequestMapping("/oil-property")
public class OilPropertyController {

    @Autowired
    private IOilPropertyService oilPropertyService;

    /**
     * 查询油品列表
     */
    @GetMapping("/list")
    public Result<List<OilProperty>> list() {
        return Result.ok(oilPropertyService.list());
    }

    /**
     * 获取油品详细信息
     */
    @GetMapping(value = "/{id}")
    public Result<OilProperty> getInfo(@PathVariable("id") Long id) {
        return Result.ok(oilPropertyService.getById(id));
    }

    /**
     * 新增油品
     */
    @PostMapping
    public Result<Boolean> add(@RequestBody OilProperty oilProperty) {
        return Result.ok(oilPropertyService.save(oilProperty));
    }

    /**
     * 修改油品
     */
    @PutMapping
    public Result<Boolean> edit(@RequestBody OilProperty oilProperty) {
        return Result.ok(oilPropertyService.updateById(oilProperty));
    }

    /**
     * 删除油品
     */
    @DeleteMapping("/{ids}")
    public Result<Boolean> remove(@PathVariable List<Long> ids) {
        return Result.ok(oilPropertyService.removeBatchByIds(ids));
    }
}
