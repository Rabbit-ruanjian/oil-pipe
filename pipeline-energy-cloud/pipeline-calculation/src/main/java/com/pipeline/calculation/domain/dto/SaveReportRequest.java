package com.pipeline.calculation.domain.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

/**
 * 智能报告归档请求。
 */
@Data
public class SaveReportRequest {

    private String title;

    private String reportType;

    private String reportTypeLabel;

    private List<Long> selectedProjectIds = new ArrayList<>();

    private List<String> projectNames = new ArrayList<>();

    private String rangeLabel;

    private String intelligenceLabel;

    private String outputFormat;

    private String sourceLabel;

    private Object result;
}
